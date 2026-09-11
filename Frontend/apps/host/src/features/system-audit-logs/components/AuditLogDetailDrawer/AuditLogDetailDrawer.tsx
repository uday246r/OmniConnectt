import { useEffect, useState } from 'react'
import { Badge, Button, DetailField, DetailGrid, DetailSection, formatAuditTimestamp, type BadgeTone } from '@omniremit/ui'
import { Icon } from '../../../../shared/components/Icon/Icon'
import { auditLogsApi, type AuditLogDto } from '../../api/auditLogsApi'
import { formatActionLabel, formatIpv4 } from '../../utils/auditLogFormatting'
// The same right-side drawer shell Settings and the System Audit Trail deep-link use — this component
// only fills the panel body, so wherever it is rendered the drawer looks identical to the rest of the host.
import drawerStyles from '../../../../layout/SettingsDrawer/SettingsDrawer.module.css'
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
 * user's own Audit Log tab both render this, so enhancing either enhances both. Previously these had
 * diverged (a rich version here, a thinner one on the user page); this is the richer one, generalised.
 *
 * Correlation ID is never shown as a raw GUID (see AuditLogAppService.ResolveCorrelationId on the
 * backend for how it's actually populated now) — instead, when more than one row shares it, this shows
 * "Related activity" and a way to jump to the rest of that operation.
 */
export function AuditLogDetailDrawer({ log, accessToken, onClose, onViewRelated }: AuditLogDetailDrawerProps) {
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
  }, [accessToken, log.correlationId])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  const parsedAgent = parseUserAgent(log.userAgent)
  const hasRelated = relatedCount !== null && relatedCount > 1

  return (
    <div className={drawerStyles.overlayRoot}>
      <div className={drawerStyles.backdrop} onClick={onClose} />
      <div className={drawerStyles.drawerContainer}>
        <div className={drawerStyles.rootPanel}>
          <div className={drawerStyles.header}>
            <div className={drawerStyles.headerLeft}>
              <div className={drawerStyles.headerIcon}>
                <Icon.Shield width={20} height={20} />
              </div>
              <div>
                <h2 className={drawerStyles.title}>Activity Details</h2>
                <p className={drawerStyles.subtitle}>What happened, who did it, and when</p>
              </div>
            </div>
            <button type="button" className={drawerStyles.closeBtn} onClick={onClose} aria-label="Close details">
              <Icon.X width={20} height={20} />
            </button>
          </div>

          <div className={drawerStyles.tabBody}>
            <div className={styles.drawerSections}>
              {/* Summary & Timeline */}
              <section className={styles.drawerSection}>
                <div className={styles.overviewTimelineGrid}>
                  <div>
                    <h3 className={styles.drawerSectionTitle}>
                      <Icon.Grid width={12} height={12} />
                      Summary
                    </h3>
                    <dl className={styles.detailList}>
                      <div className={styles.detailRow}>
                        <span className={styles.detailIcon}>
                          <Icon.Layers width={15} height={15} />
                        </span>
                        <div className={styles.detailRowBody}>
                          <dt className={styles.detailRowLabel}>Application</dt>
                          <dd className={styles.detailRowValue}>
                            <Badge tone={serviceTone(log.sourceApplication || log.serviceName)}>{log.sourceApplication || log.serviceName}</Badge>
                          </dd>
                        </div>
                      </div>

                      {log.module && (
                        <div className={styles.detailRow}>
                          <span className={styles.detailIcon}>
                            <Icon.Box width={15} height={15} />
                          </span>
                          <div className={styles.detailRowBody}>
                            <dt className={styles.detailRowLabel}>Module</dt>
                            <dd className={styles.detailRowValue}>
                              <span>{log.module}</span>
                            </dd>
                          </div>
                        </div>
                      )}

                      <div className={styles.detailRow}>
                        <span className={`${styles.detailIcon} ${styles.detailIconNeutral}`}>
                          <Icon.Activity width={15} height={15} />
                        </span>
                        <div className={styles.detailRowBody}>
                          <dt className={styles.detailRowLabel}>What Happened</dt>
                          <dd className={styles.detailRowValue}>
                            <span>{formatActionLabel(log.action)}</span>
                          </dd>
                        </div>
                      </div>

                      <div className={styles.detailRow}>
                        <span className={`${styles.detailIcon} ${log.result === 'Success' ? styles.detailIconSuccess : styles.detailIconDanger}`}>
                          {log.result === 'Success' ? <Icon.CheckCircle width={15} height={15} /> : <Icon.AlertTriangle width={15} height={15} />}
                        </span>
                        <div className={styles.detailRowBody}>
                          <dt className={styles.detailRowLabel}>Outcome</dt>
                          <dd className={styles.detailRowValue}>
                            <Badge tone={log.result === 'Success' ? 'success' : 'danger'} dot>
                              {log.result}
                            </Badge>
                          </dd>
                        </div>
                      </div>

                      <div className={styles.detailRow}>
                        <span className={`${styles.detailIcon} ${styles.detailIconPurple}`}>
                          <Icon.Clock width={15} height={15} />
                        </span>
                        <div className={styles.detailRowBody}>
                          <dt className={styles.detailRowLabel}>Date &amp; Time</dt>
                          <dd className={styles.detailRowValue}>{formatAuditTimestamp(log.occurredAt)}</dd>
                        </div>
                      </div>
                    </dl>
                  </div>

                  <div className={styles.overviewTimelineColDivider}>
                    <h3 className={styles.drawerSectionTitle}>
                      <Icon.Clock width={12} height={12} />
                      Timeline
                    </h3>
                    <div className={styles.timeline}>
                      <div className={styles.timelineStep}>
                        <span className={styles.timelineDot} />
                        <div className={styles.timelineStepCard}>
                          <span className={styles.timelineLabel}>
                            {log.actorName ? `Started by ${log.actorName}` : 'Activity recorded'}
                          </span>
                          <span className={styles.timelineTime}>
                            <Icon.Clock width={12} height={12} />
                            {formatAuditTimestamp(log.occurredAt)}
                          </span>
                        </div>
                      </div>

                      <div className={styles.timelineStep}>
                        <span className={`${styles.timelineDot} ${log.result === 'Success' ? styles.timelineDotSuccess : styles.timelineDotDanger}`} />
                        <div className={styles.timelineStepCard}>
                          <span className={styles.timelineLabel}>{log.result === 'Success' ? 'Finished successfully' : 'Did not complete'}</span>
                          <span className={styles.timelineTime}>
                            <Icon.ShieldCheck width={12} height={12} />
                            {log.serviceName}
                          </span>
                        </div>
                      </div>
                    </div>

                    {log.failureReason && (
                      <div className={styles.failureAlert}>
                        <Icon.AlertTriangle className={styles.failureAlertIcon} width={15} height={15} />
                        <div>
                          <strong>Why it failed:</strong> {log.failureReason}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              </section>

              {/*
                Every field below is omitted when the record carries no value for it — DetailField
                returns null rather than printing "Not recorded" or an em dash. "Actor ID" and raw
                "Entity ID" are never shown at all: a database GUID means nothing to the person
                reading an audit trail and can't be acted on, so the name carries the same meaning
                in a form a human can actually use.
              */}
              <DetailSection title="Who Did This" icon={<Icon.User width={12} height={12} />}>
                <DetailGrid>
                  <DetailField label="Performed By" icon={<Icon.User width={15} height={15} />}>
                    {log.actorName ?? 'System'}
                  </DetailField>
                  <DetailField label="Sign-in Method" icon={<Icon.Shield width={15} height={15} />}>
                    {log.authMethod ? <span className={styles.authPill}>{log.authMethod}</span> : null}
                  </DetailField>
                  <DetailField label="IP Address" icon={<Icon.Globe width={15} height={15} />}>
                    {log.sourceIp ? (
                      <span className={styles.ipBadge}>
                        <span className={styles.ipDot} />
                        {formatIpv4(log.sourceIp)}
                      </span>
                    ) : null}
                  </DetailField>
                </DetailGrid>
              </DetailSection>

              <DetailSection title="Device Used" icon={<Icon.Globe width={12} height={12} />} hidden={!parsedAgent}>
                <DetailGrid>
                  <DetailField label="Browser" icon={<Icon.Globe width={15} height={15} />}>
                    {parsedAgent ? <span className={styles.browserPill}>{parsedAgent.browser}</span> : null}
                  </DetailField>
                  <DetailField label="Operating System" icon={<Icon.Box width={15} height={15} />}>
                    {parsedAgent ? <span className={styles.osPill}>{parsedAgent.os}</span> : null}
                  </DetailField>
                </DetailGrid>
              </DetailSection>

              <DetailSection title="Affected Record" icon={<Icon.Box width={12} height={12} />} hidden={!log.entityType && !log.entityLabel && !log.page}>
                <DetailGrid>
                  <DetailField label="Record Type" icon={<Icon.Layers width={15} height={15} />}>
                    <Badge tone="neutral">{log.entityType || (log.actionCategory === 'Navigation' ? 'Page' : 'Record')}</Badge>
                  </DetailField>
                  <DetailField label="Record Name" icon={<Icon.FileText width={15} height={15} />}>
                    {log.entityLabel || (log.module && log.page ? `${log.module} — ${log.page}` : log.page || '—')}
                  </DetailField>
                </DetailGrid>
              </DetailSection>

              {/* Correlation ID's actual payoff: instead of a raw GUID, a way to see the rest of the
                  one operation this row belongs to (e.g. the approval that led to it, or the effect
                  it caused) — hidden entirely when this row is the only event with its id. */}
              {hasRelated && onViewRelated && (
                <DetailSection title="Related Activity" icon={<Icon.Layers width={12} height={12} />}>
                  <div className={styles.relatedActivityRow}>
                    <span className={styles.relatedActivityText}>
                      Part of an operation with <strong>{relatedCount}</strong> events.
                    </span>
                    <Button variant="secondary" size="sm" leadingIcon={<Icon.ArrowRight width={14} height={14} />} onClick={() => onViewRelated(log.correlationId)}>
                      View related events
                    </Button>
                  </div>
                </DetailSection>
              )}

              {log.details && (
                <DetailSection title="Additional Details" icon={<Icon.FileText width={12} height={12} />}>
                  <pre className={styles.payloadCodeBox}>{log.details}</pre>
                </DetailSection>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
