import styles from './Skeleton.module.css'

/**
 * Skeleton for a stat/metric card (Dashboard + Settings Overview).
 * Layout matches: rounded-square icon | label text | value text
 * Includes a 3px top accent bar matching the real card style.
 */
export function SkeletonStatCard() {
  return (
    <div className={styles.statCardSkel} aria-hidden="true">
      {/* Icon */}
      <div className={`${[styles.shimmer, styles.square].join(' ')} ${styles.ssc1}`}  />

      {/* Label + value */}
      <div className={styles.ssc2}>
        <div className={`${[styles.shimmer, styles.text].join(' ')} ${styles.ssc3}`}  />
        <div className={`${[styles.shimmer, styles.text].join(' ')} ${styles.ssc4}`}  />
      </div>
    </div>
  )
}
