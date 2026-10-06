import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  Badge,
  Button,
  DetailField,
  DetailGrid,
  DetailSection,
  DetailSections,
  Drawer,
  formatAuditTimestamp,
  type BadgeTone,
} from '@omniconnect/ui'
import { Icon } from '../../../../shared/components/Icon/Icon'
import { permissionsApi } from '../../../../shared/api/permissionsApi'
import { auditLogsApi, type AuditLogDto } from '../../api/auditLogsApi'
import { formatActionLabel, formatIpv4 } from '../../utils/auditLogFormatting'
import { buildPermissionLabels, describePermission, parseAuditDetails } from '../../utils/auditDetails'
import styles from './AuditLogDetailDrawer.module.css'

const SERVICE_TONES: Record<string, BadgeTone> = {
  AuthService: 'primary',
  // Retired service. Kept because audit rows it wrote before the migration are still in the table
  // and must still render with a tone rather than falling through to the default.
  ModuleRegistry: 'info',
  LeadService: 'warning',
  Customer360Service: 'success',
  Host: 'primary',
  'Lead Management': 'warning',
  'Customer 360': 'success',
  Dashboard: 'primary',
}

export function serviceTone(serviceName: string): BadgeTone {
  return SERVICE_TONES[serviceName] ?? 'neutral'
}

export interface ParsedUserAgent {
  browser: string
  os: string
}

export function parseUserAgent(ua?: string | null): ParsedUserAgent | null {
  if (!ua) return null
  let browser = 'Browser'
  let os = 'Device'

  if (/Windows NT 10.0|Windows NT 11/i.test(ua)) os = 'Windows 10/11'
  else if (/Windows/i.test(ua)) os = 'Windows'
  else if (/iPhone|iPad/i.test(ua)) os = 'iOS'
  else if (/Android/i.test(ua)) os = 'Android'
  else if (/Mac OS X|Macintosh/i.test(ua)) os = 'macOS'
  else if (/Linux/i.test(ua)) os = 'Linux'

  if (/Edg\/([\d.]+)/i.test(ua)) {
    const m = ua.match(/Edg\/([\d.]+)/i)
    browser = m ? `Edge ${m[1].split('.')[0]}` : 'Edge'
  } else if (/Chrome\/([\d.]+)/i.test(ua)) {
    const m = ua.match(/Chrome\/([\d.]+)/i)
    browser = m ? `Chrome ${m[1].split('.')[0]}` : 'Chrome'
  } else if (/Firefox\/([\d.]+)/i.test(ua)) {
    const m = ua.match(/Firefox\/([\d.]+)/i)
    browser = m ? `Firefox ${m[1].split('.')[0]}` : 'Firefox'
  } else if (/Version\/([\d.]+).*Safari/i.test(ua)) {
    const m = ua.match(/Version\/([\d.]+)/i)
    browser = m ? `Safari ${m[1].split('.')[0]}` : 'Safari'
  } else if (/Safari/i.test(ua)) {
    browser = 'Safari'
  }

  return { browser, os }
}

export interface AuditLogDetailDrawerProps {
  log: AuditLogDto
  /** Needed to look up how many other rows share this row's correlation id — omit to hide that lookup entirely. */
  accessToken?: string | null
  onClose: () => void
  /** Fired when the operator asks to see the rest of this row's operation. Not shown unless there IS more than one row. */
  onViewRelated?: (correlationId: string) => void
}

/**
 * The one audit-record detail view used everywhere in the host — the System Audit Trail page and a
 * user's own Audit Log tab both render this, so enhancing either enhances both.
 *
 * Built on the shared `Drawer` from @omniconnect/ui. It used to borrow the Settings drawer's
 * stylesheet for its chrome; when that stylesheet was redesigned the header, subtitle and body
 * classes it relied on disappeared, and the drawer rendered as a squashed, unreadable column. The
 * shared Drawer is the platform's contract for that chrome, so it cannot drift out from under us again.
 *
 * Correlation ID is never shown as a raw GUID (see AuditLogAppService.ResolveCorrelationId on the
 * backend for how it's actually populated now) — instead, when more than one row shares it, this shows
 * "Related activity" and a way to jump to the rest of that operation.
 */
export function AuditLogDetailDrawer({ log, accessToken, onClose, onViewRelated }: AuditLogDetailDrawerProps) {
  // A token refresh must not re-run a load (and reset what the user is editing) — only its first arrival.
  const hasAccessToken = Boolean(accessToken)
  const [relatedCount, setRelatedCount] = useState<number | null>(null)

  useEffect(() => {
    setRelatedCount(null)
    if (!accessToken || !log.correlationId) return
    let cancelled = false
    auditLogsApi
      .list(accessToken, { correlationId: log.correlationId, page: 1, pageSize: 1 })
      .then((res) => {
        if (!cancelled) setRelatedCount(res.total)
      })
      .catch(() => {
        if (!cancelled) setRelatedCount(null)
      })
    return () => {
      cancelled = true
    }
  }, [hasAccessToken, log.correlationId])

  const parsedAgent = parseUserAgent(log.userAgent)
  const hasRelated = relatedCount !== null && relatedCount > 1
  const parsedDetails = useMemo(() => parseAuditDetails(log.details), [log.details])

  // Names for a permission list, fetched only for a row that has one. Without it — or without access
  // to the catalog — the keys are still turned into words by describePermission.
  const [permissionLabels, setPermissionLabels] = useState<ReturnType<typeof buildPermissionLabels>>()
  useEffect(() => {
    if (!accessToken || !parsedDetails.hasPermissionChanges) return
    let cancelled = false
    permissionsApi
      .catalog(accessToken, false)
      .then((catalog) => {
        if (!cancelled) setPermissionLabels(buildPermissionLabels(catalog))
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [hasAccessToken, parsedDetails.hasPermissionChanges])

  const succeeded = log.result === 'Success'
  const application = log.sourceApplication || log.serviceName
  const recordName = log.entityLabel || (log.module && log.page ? `${log.module}, ${log.page}` : log.page)
  const actionLabel = formatActionLabel(log.action)
  // The sentence a reader came for. The recorded detail line usually reads as one already ("Created
  // jane@corp.com"); a row without one falls back to the action in words and what it touched.
  const statement = parsedDetails.headline || (recordName ? `${actionLabel}: ${recordName}` : actionLabel)

  // Portalled to <body>: the pages that open this (a user's Audit Log tab, the audit trail) play an
  // entrance animation with a transform, and a transformed ancestor becomes the containing block of
  // every position:fixed descendant, which clipped the overlay to the tab instead of the viewport.
  // Safe in the host, whose styles are not scoped under a wrapper id the way the remotes' are (see the
  // note on Drawer in @omniconnect/ui).
  return createPortal(
    <Drawer
      open
      onClose={onClose}
      closeLabel="Close details"
      title="Activity details"
      subtitle="What happened, who did it, and when"
      icon={<Icon.Shield width={20} height={20} />}
    >
      <DetailSections>
        {/* The answer first: what happened and whether it worked. Everything below is supporting
            evidence, so none of it repeats what this block already says. */}
        <section
          className={`${styles.verdict} ${succeeded ? styles.verdictSuccess : styles.verdictFailure}`}
          aria-label="Summary"
        >
          <div className={styles.verdictMeta}>
            <Badge tone={succeeded ? 'success' : 'danger'} dot>
              {succeeded ? 'Succeeded' : 'Failed'}
            </Badge>
            <span className={styles.verdictAction}>{actionLabel}</span>
          </div>
          <p className={styles.verdictStatement}>{statement}</p>
          <p className={styles.verdictWhen}>
            <Icon.Clock width={13} height={13} />
            <time dateTime={log.occurredAt}>{formatAuditTimestamp(log.occurredAt)}</time>
          </p>
          {log.failureReason && (
            <p className={styles.failureReason} role="note">
              <Icon.AlertTriangle width={14} height={14} />
              <span>
                <strong>Why it failed:</strong> {log.failureReason}
              </span>
            </p>
          )}
        </section>

        {/*
          Every field below is omitted when the record carries no value for it — DetailField returns
          null rather than printing "Not recorded" or an em dash. "Actor ID" and raw "Entity ID" are
          never shown: a database GUID means nothing to the person reading an audit trail, so the
          name carries the same meaning in a form a human can act on.
        */}
        <DetailSection title="Who and where" icon={<Icon.User width={12} height={12} />}>
          <DetailGrid>
            <DetailField label="Performed by" icon={<Icon.User width={15} height={15} />}>
              {log.actorName ?? 'System'}
            </DetailField>
            <DetailField label="Sign-in method" icon={<Icon.Shield width={15} height={15} />}>
              {log.authMethod}
            </DetailField>
            <DetailField label="IP address" icon={<Icon.Globe width={15} height={15} />}>
              {log.sourceIp ? <span className={styles.ip}>{formatIpv4(log.sourceIp)}</span> : null}
            </DetailField>
            <DetailField label="Browser" icon={<Icon.Globe width={15} height={15} />}>
              {parsedAgent?.browser}
            </DetailField>
            <DetailField label="Operating system" icon={<Icon.Box width={15} height={15} />}>
              {parsedAgent?.os}
            </DetailField>
          </DetailGrid>
        </DetailSection>

        <DetailSection title="Affected record" icon={<Icon.Box width={12} height={12} />}>
          <DetailGrid>
            <DetailField label="Application" icon={<Icon.Layers width={15} height={15} />}>
              <Badge tone={serviceTone(application)}>{application}</Badge>
            </DetailField>
            <DetailField label="Module" icon={<Icon.Grid width={15} height={15} />}>
              {log.module}
            </DetailField>
            <DetailField label="Record type" icon={<Icon.Layers width={15} height={15} />}>
              {log.entityType || (log.actionCategory === 'Navigation' ? 'Page' : null)}
            </DetailField>
            <DetailField label="Record" icon={<Icon.FileText width={15} height={15} />}>
              {recordName}
            </DetailField>
          </DetailGrid>
        </DetailSection>

        {/* Correlation ID's actual payoff: instead of a raw GUID, a way to see the rest of the one
            operation this row belongs to (the approval that led to it, or the effect it caused) —
            hidden entirely when this row is the only event with its id. */}
        {hasRelated && onViewRelated && (
          <DetailSection title="Related activity" icon={<Icon.Layers width={12} height={12} />}>
            <div className={styles.relatedRow}>
              <span className={styles.relatedText}>
                One of <strong>{relatedCount}</strong> events recorded for the same operation.
              </span>
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Icon.ArrowRight width={14} height={14} />}
                onClick={() => onViewRelated(log.correlationId)}
              >
                View related events
              </Button>
            </div>
          </DetailSection>
        )}

        {parsedDetails.hasPermissionChanges && (
          <DetailSection title="Permission changes" icon={<Icon.FileText width={12} height={12} />}>
            <div className={styles.permissionChanges}>
              {parsedDetails.added.length > 0 && (
                <div>
                  <h4 className={styles.permissionChangesTitle}>Granted</h4>
                  <ul className={styles.permissionList}>
                    {parsedDetails.added.map((p) => (
                      <li key={p} className={styles.permissionAdded}>
                        {describePermission(p, permissionLabels)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              {parsedDetails.removed.length > 0 && (
                <div>
                  <h4 className={styles.permissionChangesTitle}>Revoked</h4>
                  <ul className={styles.permissionList}>
                    {parsedDetails.removed.map((p) => (
                      <li key={p} className={styles.permissionRemoved}>
                        {describePermission(p, permissionLabels)}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </DetailSection>
        )}
      </DetailSections>
    </Drawer>,
    document.body,
  )
}
