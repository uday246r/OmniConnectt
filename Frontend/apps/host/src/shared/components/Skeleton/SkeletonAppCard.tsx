import styles from './Skeleton.module.css'

/**
 * Skeleton for a Settings → Applications list card.
 * Layout matches: rounded-square app icon | name + key | description | status badge | action buttons
 */
export function SkeletonAppCard() {
  return (
    <div className={styles.appCardSkel} aria-hidden="true">
      {/* Rounded-square app icon */}
      <div className={`${[styles.shimmer, styles.square].join(' ')} ${styles.sac1}`}  />

      {/* App info */}
      <div className={styles.sac2}>
        <div className={styles.sac3}>
          <div className={`${[styles.shimmer, styles.text].join(' ')} ${styles.sac4}`}  />
          <div className={`${[styles.shimmer, styles.text].join(' ')} ${styles.sac5}`}  />
        </div>
        <div className={`${[styles.shimmer, styles.text].join(' ')} ${styles.sac6}`}  />
      </div>

      {/* Right: status badge + action buttons */}
      <div className={styles.sac7}>
        <div className={`${[styles.shimmer, styles.pill].join(' ')} ${styles.sac8}`}  />
        <div className={`${[styles.shimmer, styles.square].join(' ')} ${styles.sac9}`}  />
        <div className={`${[styles.shimmer, styles.square].join(' ')} ${styles.sac9}`}  />
        <div className={`${[styles.shimmer, styles.square].join(' ')} ${styles.sac9}`}  />
      </div>
    </div>
  )
}
