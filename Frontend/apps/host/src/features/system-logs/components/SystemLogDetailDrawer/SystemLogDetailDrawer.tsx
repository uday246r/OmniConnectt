import { useEffect, useState } from 'react'
import { Badge, formatAuditTimestamp } from '@omniremit/ui'
import { Icon } from '../../../../shared/components/Icon/Icon'
import drawerStyles from '../../../../layout/SettingsDrawer/SettingsDrawer.module.css'
import styles from './SystemLogDetailDrawer.module.css'
import type { SystemLogDto } from '../../api/systemLogsApi'

interface SystemLogDetailDrawerProps {
  log: SystemLogDto | null
  onClose: () => void
  onViewRelated?: (correlationId: string) => void
}

function getTone(severity: string): 'danger' | 'warning' | 'info' | 'neutral' {
  const s = severity.toLowerCase()
  if (s === 'critical' || s === 'error') return 'danger'
  if (s === 'warning') return 'warning'
  if (s === 'info') return 'info'
  return 'neutral'
}

function getEnvTone(env: string): 'danger' | 'warning' | 'info' | 'neutral' {
  const e = env.toLowerCase()
  if (e.includes('prod')) return 'danger'
  if (e.includes('stag')) return 'warning'
  if (e.includes('dev')) return 'info'
  return 'neutral'
}

function tryPrettyJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2)
  } catch {
    return raw
  }
}

export function SystemLogDetailDrawer({ log, onClose, onViewRelated }: SystemLogDetailDrawerProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null)

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose])

  if (!log) return null

  const tone = getTone(log.severity)

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text).catch(() => {})
    setCopiedField(field)
    setTimeout(() => setCopiedField(null), 1500)
  }

  return (
    <div className={drawerStyles.overlayRoot}>
      <div className={drawerStyles.backdrop} onClick={onClose} />
      <div className={drawerStyles.drawerContainer}>
        <div className={drawerStyles.rootPanel}>
          <div className={drawerStyles.header}>
            <div className={drawerStyles.headerLeft}>
              <div className={drawerStyles.headerIcon}>
                {tone === 'danger' ? (
                  <Icon.AlertCircle width={20} height={20} />
                ) : tone === 'warning' ? (
                  <Icon.AlertTriangle width={20} height={20} />
                ) : (
                  <Icon.Info width={20} height={20} />
                )}
              </div>
              <div>
                <h2 className={drawerStyles.title}>System Log Details</h2>
                <p className={drawerStyles.subtitle}>Technical and operational event record</p>
              </div>
            </div>
            <button type="button" className={drawerStyles.closeBtn} onClick={onClose} aria-label="Close details">
              <Icon.X width={20} height={20} />
            </button>
          </div>

          <div className={drawerStyles.tabBody}>
            <div className={styles.drawerSections}>

              {/* ── Summary ── */}
              <section className={styles.drawerSection}>
                <h3 className={styles.drawerSectionTitle}><Icon.Grid width={12} height={12} />Summary</h3>
                <dl className={styles.detailList}>
                  <div className={styles.detailRow}>
                    <span className={`${styles.detailIcon} ${tone === 'danger' ? styles.detailIconDanger : tone === 'warning' ? styles.detailIconWarning : styles.detailIconInfo}`}>
                      <Icon.AlertCircle width={15} height={15} />
                    </span>
                    <div className={styles.detailRowBody}>
                      <dt className={styles.detailRowLabel}>Severity</dt>
                      <dd className={styles.detailRowValue}><Badge tone={tone}>{log.severity}</Badge></dd>
                    </div>
                  </div>

                  <div className={styles.detailRow}>
                    <span className={`${styles.detailIcon} ${styles.detailIconNeutral}`}><Icon.Layers width={15} height={15} /></span>
                    <div className={styles.detailRowBody}>
                      <dt className={styles.detailRowLabel}>Service</dt>
                      <dd className={styles.detailRowValue}>{log.serviceName}</dd>
                    </div>
                  </div>

                  {log.module && (
                    <div className={styles.detailRow}>
                      <span className={`${styles.detailIcon} ${styles.detailIconNeutral}`}><Icon.Box width={15} height={15} /></span>
                      <div className={styles.detailRowBody}>
                        <dt className={styles.detailRowLabel}>Module</dt>
                        <dd className={styles.detailRowValue}>{log.module}</dd>
                      </div>
                    </div>
                  )}

                  <div className={styles.detailRow}>
                    <span className={`${styles.detailIcon} ${styles.detailIconNeutral}`}><Icon.FileText width={15} height={15} /></span>
                    <div className={styles.detailRowBody}>
                      <dt className={styles.detailRowLabel}>Event Code</dt>
                      <dd className={styles.detailRowValue}>
                        <span className={styles.monoValue}>{log.eventCode}</span>
                        <button type="button" className={styles.copyBtn} onClick={() => copyToClipboard(log.eventCode, 'eventCode')} title="Copy event code">
                          {copiedField === 'eventCode' ? <Icon.Check width={12} height={12} /> : <Icon.Copy width={12} height={12} />}
                        </button>
                      </dd>
                    </div>
                  </div>

                  <div className={styles.detailRow}>
                    <span className={`${styles.detailIcon} ${styles.detailIconPurple}`}><Icon.Clock width={15} height={15} /></span>
                    <div className={styles.detailRowBody}>
                      <dt className={styles.detailRowLabel}>Occurred At</dt>
                      <dd className={styles.detailRowValue}>{formatAuditTimestamp(log.occurredAt)}</dd>
                    </div>
                  </div>

                  {log.environment && (
                    <div className={styles.detailRow}>
                      <span className={`${styles.detailIcon} ${styles.detailIconNeutral}`}><Icon.Globe width={15} height={15} /></span>
                      <div className={styles.detailRowBody}>
                        <dt className={styles.detailRowLabel}>Environment</dt>
                        <dd className={styles.detailRowValue}><Badge tone={getEnvTone(log.environment)}>{log.environment}</Badge></dd>
                      </div>
                    </div>
                  )}
                </dl>
              </section>

              {/* ── Message ── */}
              <section className={styles.drawerSection}>
                <h3 className={styles.drawerSectionTitle}>
                  <Icon.FileText width={12} height={12} />
                  Message
                  <button type="button" className={styles.copyBtnInline} onClick={() => copyToClipboard(log.message, 'message')} title="Copy message">
                    {copiedField === 'message' ? <><Icon.Check width={11} height={11} /> Copied</> : <><Icon.Copy width={11} height={11} /> Copy</>}
                  </button>
                </h3>
                <p className={styles.messageBox}>{log.message}</p>
              </section>

              {/* ── Technical Context ── */}
              <section className={styles.drawerSection}>
                <h3 className={styles.drawerSectionTitle}><Icon.Settings width={12} height={12} />Technical Context</h3>
                <dl className={styles.detailList}>
                  {log.statusCode && (
                    <div className={styles.detailRow}>
                      <dt className={styles.detailRowLabel}>Status Code</dt>
                      <dd className={styles.detailRowValue}>
                        <Badge tone={log.statusCode >= 500 ? 'danger' : log.statusCode >= 400 ? 'warning' : 'success'}>{log.statusCode}</Badge>
                      </dd>
                    </div>
                  )}
                  {log.requestId && (
                    <div className={styles.detailRow}>
                      <dt className={styles.detailRowLabel}>Request ID</dt>
                      <dd className={styles.detailRowValue}>
                        <span className={styles.monoValue}>{log.requestId}</span>
                        <button type="button" className={styles.copyBtn} onClick={() => copyToClipboard(log.requestId!, 'requestId')}>
                          {copiedField === 'requestId' ? <Icon.Check width={12} height={12} /> : <Icon.Copy width={12} height={12} />}
                        </button>
                      </dd>
                    </div>
                  )}

                  {/* Correlation ID — always show */}
                  <div className={styles.detailRow}>
                    <dt className={styles.detailRowLabel}>Correlation ID</dt>
                    <dd className={styles.detailRowValue}>
                      <span className={styles.monoValue}>{log.correlationId}</span>
                      <button type="button" className={styles.copyBtn} onClick={() => copyToClipboard(log.correlationId, 'correlationId')}>
                        {copiedField === 'correlationId' ? <Icon.Check width={12} height={12} /> : <Icon.Copy width={12} height={12} />}
                      </button>
                      {onViewRelated && (
                        <button
                          type="button"
                          className={styles.viewRelatedBtn}
                          onClick={() => { onViewRelated(log.correlationId); onClose() }}
                        >
                          <Icon.Link width={12} height={12} />
                          View Related Logs
                        </button>
                      )}
                    </dd>
                  </div>
                </dl>
              </section>

              {/* ── Tenant / User Context ── */}
              <section className={styles.drawerSection}>
                <h3 className={styles.drawerSectionTitle}><Icon.Users width={12} height={12} />Tenant & User Context</h3>
                <dl className={styles.detailList}>
                  <div className={styles.detailRow}>
                    <dt className={styles.detailRowLabel}>Tenant ID</dt>
                    <dd className={styles.detailRowValue}>
                      {log.tenantId
                        ? <><span className={styles.monoValue}>{log.tenantId}</span><button type="button" className={styles.copyBtn} onClick={() => copyToClipboard(log.tenantId!, 'tenantId')}><Icon.Copy width={12} height={12} /></button></>
                        : <span className={styles.mutedValue}>N/A</span>}
                    </dd>
                  </div>
                  <div className={styles.detailRow}>
                    <dt className={styles.detailRowLabel}>User ID</dt>
                    <dd className={styles.detailRowValue}>
                      {log.userId
                        ? <><span className={styles.monoValue}>{log.userId}</span><button type="button" className={styles.copyBtn} onClick={() => copyToClipboard(log.userId!, 'userId')}><Icon.Copy width={12} height={12} /></button></>
                        : <span className={styles.mutedValue}>N/A — system event</span>}
                    </dd>
                  </div>
                </dl>
              </section>

              {/* ── Stack Trace ── */}
              {log.stackTrace && (
                <section className={styles.drawerSection}>
                  <h3 className={styles.drawerSectionTitle}>
                    <Icon.AlertCircle width={12} height={12} />
                    Sanitized Stack Trace
                    <button type="button" className={styles.copyBtnInline} onClick={() => copyToClipboard(log.stackTrace!, 'stackTrace')}>
                      {copiedField === 'stackTrace' ? <><Icon.Check width={11} height={11} /> Copied</> : <><Icon.Copy width={11} height={11} /> Copy</>}
                    </button>
                  </h3>
                  <pre className={styles.stackTraceBox}>{log.stackTrace}</pre>
                </section>
              )}

              {/* ── Metadata ── */}
              {log.metadata && (
                <section className={styles.drawerSection}>
                  <h3 className={styles.drawerSectionTitle}>
                    <Icon.Activity width={12} height={12} />
                    Metadata
                    <button type="button" className={styles.copyBtnInline} onClick={() => copyToClipboard(log.metadata!, 'metadata')}>
                      {copiedField === 'metadata' ? <><Icon.Check width={11} height={11} /> Copied</> : <><Icon.Copy width={11} height={11} /> Copy</>}
                    </button>
                  </h3>
                  <pre className={styles.metadataBox}>{tryPrettyJson(log.metadata)}</pre>
                </section>
              )}

            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
