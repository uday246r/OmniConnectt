import styles from './Skeleton.module.css'

/**
 * Skeleton for the Dashboard's "Users by Role" donut chart widget.
 * Layout matches: 148px ring | legend rows (dot | name | count) — see
 * DashboardPage.module.css .donutContainer/.donutSvgWrap/.legendList.
 *
 * The widget previously had no loading branch at all: during the stats fetch
 * roleDistribution is [], so the real chart rendered as a bare gray ring with
 * an empty legend — not a skeleton, just the empty state briefly flashing.
 */
export function SkeletonDonutChart() {
  return (
    <div className={styles.donutSkelContainer} aria-hidden="true">
      <div className={styles.donutSkelRingWrap}>
        {/* 140x140 / r=54 / strokeWidth=18 mirrors the real donut in DashboardPage exactly. */}
        <svg width="140" height="140" viewBox="0 0 150 150">
          <circle cx="75" cy="75" r="54" fill="transparent" stroke="#eaecf0" strokeWidth="18" />
        </svg>
        {/*
          The centre holds a 24px total and a small uppercase "Total" beneath it, so the placeholder
          is two stacked blocks. It was a single full-width bar, which read as a line struck through
          the ring rather than as a number.
        */}
        <div className={styles.donutSkelCenter}>
          <div className={`${[styles.shimmer, styles.text].join(' ')} ${styles.sdcNum}`} />
          <div className={`${[styles.shimmer, styles.text].join(' ')} ${styles.sdcLabel}`} />
        </div>
      </div>

      <div className={styles.legendSkelList}>
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className={styles.legendSkelItem}>
            <div className={`${[styles.shimmer, styles.avatar].join(' ')} ${styles.sdc2}`}  />
            <div className={[styles.shimmer, styles.text].join(' ')} style={{ '--sk-width': `${60 - i * 8}%` } as React.CSSProperties} />
            <div className={`${[styles.shimmer, styles.text].join(' ')} ${styles.sdc3}`}  />
          </div>
        ))}
      </div>
    </div>
  )
}
