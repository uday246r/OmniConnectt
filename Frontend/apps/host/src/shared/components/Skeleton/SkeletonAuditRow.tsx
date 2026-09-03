import styles from './Skeleton.module.css'

/**
 * Skeleton for an audit log table row.
 * Layout matches: circle actor avatar | actor name | entity type | action badge | timestamp
 */
export function SkeletonAuditRow() {
  return (
    <div className={styles.auditRowSkel} aria-hidden="true">
      {/* Actor circle avatar */}
      <div className={`${[styles.shimmer, styles.avatar].join(' ')} ${styles.sar1}`}  />

      {/* Actor name + email */}
      <div className={styles.sar2}>
        <div className={`${[styles.shimmer, styles.text].join(' ')} ${styles.sar3}`}  />
        <div className={`${[styles.shimmer, styles.text].join(' ')} ${styles.sar4}`}  />
      </div>

      {/* Entity type column */}
      <div className={styles.sar5}>
        <div className={`${[styles.shimmer, styles.text].join(' ')} ${styles.sar6}`}  />
      </div>

      {/* Action badge — pill shape */}
      <div className={styles.sar7}>
        <div className={`${[styles.shimmer, styles.pill].join(' ')} ${styles.sar8}`}  />
      </div>

      {/* Timestamp */}
      <div className={styles.sar9}>
        <div className={`${[styles.shimmer, styles.text].join(' ')} ${styles.sar3}`}  />
      </div>
    </div>
  )
}
