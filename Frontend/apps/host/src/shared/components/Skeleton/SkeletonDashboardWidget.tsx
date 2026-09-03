import styles from './Skeleton.module.css'

/**
 * Skeleton for a Dashboard app widget row.
 * Layout matches: rounded-square icon | app name line | URL/key line
 */
export function SkeletonDashboardWidget() {
  return (
    <div className={styles.dashWidgetSkel} aria-hidden="true">
      {/* App icon */}
      <div className={`${[styles.shimmer, styles.square].join(' ')} ${styles.sdw1}`}  />
      {/* Name + key */}
      <div className={styles.sdw2}>
        <div className={`${[styles.shimmer, styles.text].join(' ')} ${styles.sdw3}`}  />
        <div className={`${[styles.shimmer, styles.text].join(' ')} ${styles.sdw4}`}  />
      </div>
      {/* Status pill */}
      <div className={`${[styles.shimmer, styles.pill].join(' ')} ${styles.sdw5}`}  />
    </div>
  )
}
