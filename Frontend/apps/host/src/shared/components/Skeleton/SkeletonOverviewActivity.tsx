import styles from './Skeleton.module.css'

/**
 * Skeleton for a Settings Overview activity list item.
 * Layout matches: colored dot | activity text line | time line
 */
export function SkeletonOverviewActivity() {
  return (
    <div className={styles.activityItemSkel} aria-hidden="true">
      {/* Dot indicator */}
      <div
        className={`${styles.shimmer} ${styles.soa1}`}

      />
      {/* Text */}
      <div className={styles.soa2}>
        <div className={`${[styles.shimmer, styles.text].join(' ')} ${styles.soa3}`}  />
        <div className={`${[styles.shimmer, styles.text].join(' ')} ${styles.soa4}`}  />
      </div>
    </div>
  )
}
