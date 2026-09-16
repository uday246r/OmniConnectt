import { ActorCell, Badge, formatAuditTimestamp } from '@omniconnect/ui'
import { Icon } from '../../../../shared/components/Icon/Icon'
import type { AuditLogDto } from '../../api/auditLogsApi'
import { formatActionLabel } from '../../utils/auditLogFormatting'
import { serviceTone } from '../AuditLogDetailDrawer/AuditLogDetailDrawer'
import styles from './OperationTimeline.module.css'

export interface OperationTimelineProps {
  /** Already sorted oldest-first — this component draws the story in the order given, it doesn't re-sort. */
  logs: AuditLogDto[]
  onView: (log: AuditLogDto) => void
}

/**
 * One correlated operation, drawn as a connected thread instead of a flat table: a rail runs down
 * through every step's dot, so "approval.requested → approval.approved → user.created" reads as
 * one continuous event rather than three unrelated rows that happen to share a filter value.
 *
 * Swapped in by AuditLogsPage in place of the normal DataTable whenever a `correlationId` filter is
 * active — an operation is a handful of steps, not a page of data, so a table (built for scanning
 * many similar rows) was the wrong shape for "what happened, in order" to begin with.
 */
export function OperationTimeline({ logs, onView }: OperationTimelineProps) {
  return (
    <div className={styles.timeline}>
      {logs.map((log, i) => {
        const isLast = i === logs.length - 1
        const success = log.result === 'Success'
        return (
          <div className={styles.node} key={log.id}>
            <div className={styles.railCol}>
              <span className={`${styles.dot} ${success ? styles.dotSuccess : styles.dotDanger}`} />
              {!isLast && <span className={styles.rail} />}
            </div>

            <button type="button" className={styles.card} onClick={() => onView(log)}>
              <div className={styles.cardTop}>
                <span className={styles.stepBadge}>Step {i + 1} of {logs.length}</span>
                <span className={styles.time}>{formatAuditTimestamp(log.occurredAt)}</span>
              </div>

              <div className={styles.cardMain}>
                <Badge tone={serviceTone(log.serviceName)}>{log.serviceName}</Badge>
                <span className={styles.actionChip}>{formatActionLabel(log.action)}</span>
                <span className={styles.arrowSep}>
                  <Icon.ArrowRight width={12} height={12} />
                </span>
                <ActorCell name={log.actorName} fallback="System" />
                {(log.entityLabel || log.entityType) && (
                  <span className={styles.entity}>
                    {log.entityLabel ? <span className={styles.entityLabel}>{log.entityLabel}</span> : null}
                    {log.entityLabel && log.entityType ? ' · ' : ''}
                    {log.entityType}
                  </span>
                )}
                <Badge tone={success ? 'success' : 'danger'} dot>
                  {log.result}
                </Badge>
                <span className={styles.chevron}>
                  <Icon.ChevronRight width={16} height={16} />
                </span>
              </div>
            </button>
          </div>
        )
      })}
    </div>
  )
}
