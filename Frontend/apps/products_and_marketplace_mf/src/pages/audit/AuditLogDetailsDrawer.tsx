import { useEffect, useState } from 'react';
import { Badge, Button, DetailField, DetailGrid, DetailSection, DetailSections, Drawer, EmptyState, Icon, SkeletonBlock, formatAuditTimestamp } from '@omniconnect/ui';
import { auditLogApi } from '../../services/auditLogApi';
import { useAuditLogStore } from '../../stores/useAuditLogStore';
import { formatAuditAction } from '../../utils/format';
import type { AuditLog } from '../../types/domain';

export interface AuditLogDetailsDrawerProps {
  /** The record to show, or null when closed. */
  auditLogId: string | null;
  onClose: () => void;
}

/**
 * One audit record, as recorded.
 *
 * Shown from the list when it is already loaded, otherwise fetched. A failed load says so and offers a
 * retry rather than leaving a skeleton on screen forever. Empty fields are omitted by the shared
 * `DetailField` — only what was recorded is shown, never a placeholder.
 */
export function AuditLogDetailsDrawer({ auditLogId, onClose }: AuditLogDetailsDrawerProps) {
  const open = auditLogId !== null;
  const known = useAuditLogStore((s) => s.items.find((i) => i.id === auditLogId) ?? null);
  const [fetched, setFetched] = useState<AuditLog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const entry = known ?? (fetched?.id === auditLogId ? fetched : null);

  useEffect(() => {
    if (!auditLogId || known) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    auditLogApi
      .getById(auditLogId)
      .then((data) => !cancelled && setFetched(data))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error && err.message ? err.message : 'This audit record could not be loaded.'))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [auditLogId, known, attempt]);

  return (
    <Drawer
      open={open}
      onClose={onClose}
      icon={<Icon.ShieldCheck />}
      title="Audit record"
      subtitle={entry ? formatAuditAction(entry.action) : 'What happened, and who did it'}
    >
      {error ? (
        <EmptyState
          title="Could not load this record"
          description={error}
          action={<Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>Retry</Button>}
        />
      ) : loading || !entry ? (
        <SkeletonBlock width="100%" height={220} />
      ) : (
        <DetailSections>
          <DetailSection title="What happened">
            <DetailGrid>
              <DetailField label="Result"><Badge tone={entry.success ? 'success' : 'danger'} dot>{entry.success ? 'Success' : 'Failed'}</Badge></DetailField>
              <DetailField label="When" icon={<Icon.Clock />}>{formatAuditTimestamp(entry.timestamp)}</DetailField>
              <DetailField label="Description" full>{entry.description}</DetailField>
            </DetailGrid>
          </DetailSection>
          <DetailSection title="Who did this">
            <DetailGrid>
              <DetailField label="Performed by" icon={<Icon.User />}>{entry.actorName}</DetailField>
              <DetailField label="Email">{entry.actorEmail}</DetailField>
              <DetailField label="IP address" mono>{entry.ipAddress}</DetailField>
            </DetailGrid>
          </DetailSection>
          <DetailSection title="Affected record">
            <DetailGrid>
              <DetailField label="Record type">{entry.entityType}</DetailField>
              <DetailField label="Record name">{entry.entityName}</DetailField>
            </DetailGrid>
          </DetailSection>
          {(entry.previousValue || entry.newValue) && (
            <DetailSection title="What changed">
              <DetailGrid>
                <DetailField label="Before">{entry.previousValue}</DetailField>
                <DetailField label="After">{entry.newValue}</DetailField>
              </DetailGrid>
            </DetailSection>
          )}
        </DetailSections>
      )}
    </Drawer>
  );
}
