import styles from './Skeleton.module.css'

/**
 * Skeleton for a Settings → Roles list card.
 * Layout matches: rounded-square icon | role name + badge | description | edit button
 */
export function SkeletonRoleCard() {
  return (
    <div className={styles.roleCardSkel} aria-hidden="true">
      {/* Rounded-square icon */}
      <div className={`${[styles.shimmer, styles.square].join(' ')} ${styles.src1}`}  />

      {/* Name + description */}
      <div className={styles.src2}>
        <div className={styles.src3}>
          <div className={`${[styles.shimmer, styles.text].join(' ')} ${styles.src4}`}  />
          <div className={`${[styles.shimmer, styles.pill].join(' ')} ${styles.src5}`}  />
        </div>
        <div className={`${[styles.shimmer, styles.text].join(' ')} ${styles.src6}`}  />
      </div>

      {/* Right: edit icon button */}
      <div className={styles.src7}>
        <div className={`${[styles.shimmer, styles.square].join(' ')} ${styles.src8}`}  />
        <div className={`${[styles.shimmer, styles.square].join(' ')} ${styles.src8}`}  />
      </div>
    </div>
  )
}
