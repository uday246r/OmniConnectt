import styles from './Skeleton.module.css'

export interface SkeletonTableProps {
  rows?: number
  columns?: number
}

/** Placeholder rows for a data table while its page loads — used by Users/Roles/RemoteApps tables. */
export function SkeletonTable({ rows = 5, columns = 4 }: SkeletonTableProps) {
  return (
    <div className={styles.table} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className={styles.tableRow}>
          {Array.from({ length: columns }, (_, c) => (
            <div key={c} className={[styles.shimmer, styles.tableCell].join(' ')} style={{ flex: c === 0 ? 2 : 1 }} />
          ))}
        </div>
      ))}
    </div>
  )
}
