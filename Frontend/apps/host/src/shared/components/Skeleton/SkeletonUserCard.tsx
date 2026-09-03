import styles from './Skeleton.module.css'

/**
 * Skeleton for a Settings → Users list card.
 * Layout matches: circle avatar | name + email lines | pill badge | 2 icon buttons
 */
export function SkeletonUserCard() {
  return (
    <div className={styles.userCardSkel} aria-hidden="true">
      {/* Circle avatar */}
      <div className={`${[styles.shimmer, styles.avatar].join(' ')} ${styles.suc1}`}  />

      {/* Name + email */}
      <div className={styles.suc2}>
        <div className={styles.suc3}>
          <div className={`${[styles.shimmer, styles.text].join(' ')} ${styles.suc4}`}  />
          {/* Role pill */}
          <div className={`${[styles.shimmer, styles.pill].join(' ')} ${styles.suc5}`}  />
        </div>
        <div className={`${[styles.shimmer, styles.text].join(' ')} ${styles.suc6}`}  />
      </div>

      {/* Right: status badge + 2 icon buttons */}
      <div className={styles.suc7}>
        <div className={`${[styles.shimmer, styles.pill].join(' ')} ${styles.suc8}`}  />
        <div className={`${[styles.shimmer, styles.square].join(' ')} ${styles.suc9}`}  />
        <div className={`${[styles.shimmer, styles.square].join(' ')} ${styles.suc9}`}  />
      </div>
    </div>
  )
}
