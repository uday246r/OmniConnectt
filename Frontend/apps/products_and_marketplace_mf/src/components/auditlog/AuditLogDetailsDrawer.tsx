import { useEffect, useState } from "react";
import { Badge, Button, DetailField, DetailGrid, EmptyState, SkeletonBlock, formatAuditTimestamp } from "@omniconnect/ui";
import { Drawer, DrawerSection } from "../drawer/Drawer";
import { Icon } from "../common/Icon";
import { useAuditLogStore } from "../../stores/useAuditLogStore";
import { useDrawerStore } from "../../stores/useDrawerStore";
import { auditLogApi } from "../../services/auditLogApi";
import type { AuditLog } from "../../types/domain";

function formatAction(action: string): string {
  return action
    .replace(/[._]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

/**
 * One Products audit record, as recorded.
 *
 * Fixed here: a failed load left the drawer on a skeleton forever (the request's rejection was never
 * handled); the service was printed as a hard-coded "ProductMarketplace"; times used a pinned en-IN
 * locale while the host's audit trail uses the platform format; and absent values were printed as "-".
 * Empty fields are now omitted by the shared DetailField, and no record identifier is shown.
 */
export function AuditLogDetailsDrawer({ auditLogId }: { auditLogId: string }) {
  const { items } = useAuditLogStore();
  const { close } = useDrawerStore();
  const [entry, setEntry] = useState<AuditLog | null>(items.find((i) => i.id === auditLogId) ?? null);
  const [loading, setLoading] = useState(!entry);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (entry) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    auditLogApi
      .getById(auditLogId)
      .then((data) => {
        if (!cancelled) setEntry(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error && err.message ? err.message : "This audit record could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditLogId, attempt]);

  return (
    <Drawer
      isOpen
      onClose={close}
      icon={<Icon name="shield" size={20} />}
      title="Audit Record Details"
      subtitle={entry ? formatAction(entry.action) : "Event context and who performed it"}
      badge={
        entry && (
          <Badge tone={entry.success ? "success" : "danger"} dot>
            {entry.success ? "Success" : "Failed"}
          </Badge>
        )
      }
    >
      {error ? (
        <EmptyState
          title="Could not load this record"
          description={error}
          action={
            <Button variant="secondary" size="sm" onClick={() => setAttempt((n) => n + 1)}>
              Retry
            </Button>
          }
        />
      ) : loading || !entry ? (
        <SkeletonBlock width="100%" height={220} />
      ) : (
        <>
          <DrawerSection title="What Happened" icon="grid">
            <DetailGrid>
              <DetailField label="Action">{formatAction(entry.action)}</DetailField>
              <DetailField label="When" icon={<Icon name="clock" size={15} />}>{formatAuditTimestamp(entry.timestamp)}</DetailField>
              <DetailField label="Description" full>{entry.description}</DetailField>
            </DetailGrid>
          </DrawerSection>

          <DrawerSection title="Who Did This" icon="user">
            <DetailGrid>
              <DetailField label="Performed By" icon={<Icon name="user" size={15} />}>{entry.actorName}</DetailField>
              <DetailField label="Email">{entry.actorEmail}</DetailField>
              {/* Only what was recorded — never a made-up role or a placeholder address. */}
              <DetailField label="IP Address" mono>{entry.ipAddress}</DetailField>
            </DetailGrid>
          </DrawerSection>

          <DrawerSection title="Affected Record" icon="package">
            <DetailGrid>
              <DetailField label="Record Type">{entry.entityType}</DetailField>
              <DetailField label="Record Name">{entry.entityName}</DetailField>
            </DetailGrid>
          </DrawerSection>

          {(entry.previousValue || entry.newValue) && (
            <DrawerSection title="What Changed" icon="refresh-cw">
              <DetailGrid>
                <DetailField label="Before">{entry.previousValue}</DetailField>
                <DetailField label="After">{entry.newValue}</DetailField>
              </DetailGrid>
            </DrawerSection>
          )}
        </>
      )}
    </Drawer>
  );
}
