import { SkeletonText } from '../../../../shared/components/Skeleton'
import type { HealthEntryDto } from '../../api/dashboardApi'
import styles from './SystemHealthPanel.module.css'

export interface SystemHealthPanelProps {
  entries?: HealthEntryDto[]
  loading?: boolean
  error?: string | null
}

const TONE: Record<string, { className: string; label: string }> = {
  Healthy: { className: 'ok', label: 'Operational' },
  Unreachable: { className: 'down', label: 'Not responding' },
  Unknown: { className: 'unknown', label: 'Not checked yet' },
}

function relativeTime(iso: string | null): string | null {
  if (!iso) return null
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return null

  const seconds = Math.round((Date.now() - then) / 1000)
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`
  return `${Math.floor(seconds / 86400)}d ago`
}

/**
 * Live reachability of every registered remote app.
 *
 * Everything here is a real probe result recorded by AuthService's background health service —
 * nothing is inferred from whether a request happened to succeed, and an app that has not been
 * probed yet reports "Not checked yet" rather than being coloured green or red on a guess.
 *
 * This is the widget that surfaces an outage BEFORE a user clicks into a broken app — the exact
 * failure mode that produced the original "Couldn't load Employee Management" report.
 */
export function SystemHealthPanel({ entries, loading, error }: SystemHealthPanelProps) {
  return (
    <section className={styles.panel} aria-labelledby="system-health-heading">
      <div className={styles.header}>
        <h2 id="system-health-heading" className={styles.title}>
          System health
        </h2>
      </div>

      {loading ? (
        <SkeletonText lines={3} />
      ) : error ? (
        <p className={styles.error}>{error}</p>
      ) : !entries || entries.length === 0 ? (
        <p className={styles.empty}>No applications registered yet.</p>
      ) : (
        <ul className={styles.list}>
          {entries.map((entry) => {
            const tone = TONE[entry.health] ?? TONE.Unknown
            const checked = relativeTime(entry.lastCheckedAt)
            return (
              <li key={entry.key} className={styles.row}>
                <span className={`${styles.dot} ${styles[tone.className]}`} aria-hidden="true" />
                <div className={styles.rowText}>
                  <span className={styles.name}>{entry.displayName}</span>
                  <span className={styles.status}>
                    {tone.label}
                    {checked && <span className={styles.checked}> · checked {checked}</span>}
                  </span>
                  {/* Real transport error from the probe, shown verbatim — never a generic placeholder. */}
                  {entry.error && <span className={styles.errorDetail}>{entry.error}</span>}
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
