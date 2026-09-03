import { SkeletonBlock } from '../Skeleton'
import styles from './PageSkeleton.module.css'

/**
 * Placeholder for a page's own content, shown while its route chunk downloads.
 *
 * This exists because `AppShellSkeleton` was being used for that job, and it is the wrong shape: it
 * draws a sidebar rail and a topbar, which is right during hydration (nothing real has mounted yet)
 * but wrong here — by the time a page chunk is loading, the real Sidebar and Topbar are already on
 * screen, so the user saw a second, fake sidebar and navbar rendered inside the content area.
 *
 * The shape mirrors what the authenticated pages actually render: a hero banner, a row of stat
 * cards, a toolbar, then a table. Audit Logs, Approval Center and My Requests all share it, so the
 * real page drops in without the layout jumping.
 */
export function PageSkeleton() {
  return (
    <div className={styles.page} role="status" aria-live="polite" aria-busy="true">
      <span className="omni-visually-hidden">Loading…</span>

      {/* Hero banner */}
      <SkeletonBlock height={110} radius="18px" />

      {/* Stat cards */}
      <div className={styles.statGrid}>
        {Array.from({ length: 4 }, (_, i) => (
          <SkeletonBlock key={i} height={96} radius="14px" />
        ))}
      </div>

      {/* Toolbar: tabs on the left, row controls and actions on the right */}
      <div className={styles.toolbar}>
        <div className={styles.toolbarLeft}>
          {[110, 90, 120].map((w, i) => (
            <SkeletonBlock key={i} width={w} height={34} radius="9px" />
          ))}
        </div>
        <div className={styles.toolbarRight}>
          <SkeletonBlock width={92} height={34} radius="9px" />
          <SkeletonBlock width={104} height={34} radius="9px" />
          <SkeletonBlock width={126} height={34} radius="9px" />
        </div>
      </div>

      {/* Table: header rule, then rows */}
      <div className={styles.table}>
        <div className={styles.tableHead}>
          {[90, 110, 130, 100, 80, 70].map((w, i) => (
            <SkeletonBlock key={i} width={w} height={12} radius="4px" />
          ))}
        </div>
        {Array.from({ length: 6 }, (_, r) => (
          <div key={r} className={styles.tableRow}>
            {[130, 96, 150, 120, 70, 56].map((w, c) => (
              <SkeletonBlock key={c} width={w} height={15} radius="4px" />
            ))}
          </div>
        ))}
      </div>
    </div>
  )
}
