import { SkeletonBlock } from '@omniconnect/ui'
import styles from './UserDetailSkeleton.module.css'

/**
 * Shape-matched skeleton for the User Detail page.
 *
 * Built from raw SkeletonBlock primitives only — no real component wrappers.
 * Mirrors the exact visual geometry of UserDetailPage so there is zero layout
 * shift when the real content arrives.
 *
 * Layout hierarchy it mirrors:
 *   1. PageHeader  — gradient banner: icon tile | name + subtitle + chips | action buttons
 *   2. .navBar     — white card with blue top border + 3 pill-tab placeholders
 *   3. DetailSections — 2 white bordered cards, each with title pill + 2-col field grid
 */
export function UserDetailSkeleton() {
  return (
    <div className={styles.page} role="status" aria-live="polite" aria-busy="true">
      <span className="omni-visually-hidden">Loading user details…</span>

      {/* ── 1. PageHeader banner skeleton ─────────────────────── */}
      <div className={styles.banner}>
        {/* Left: icon tile + name block */}
        <div className={styles.bannerLeft}>
          {/* Glass icon tile (50×50) — uses a ghost variant class on the banner bg */}
          <div className={styles.bannerIconTile} aria-hidden="true" />
          <div className={styles.bannerTitleGroup}>
            {/* Title + chips row */}
            <div className={styles.bannerTitleRow}>
              <div className={styles.bannerBlock} style={{ width: 200, height: 26 }} aria-hidden="true" />
              <div className={styles.bannerChips}>
                <div className={styles.bannerPill} style={{ width: 88 }} aria-hidden="true" />
                <div className={styles.chipDivider} />
                <div className={styles.bannerPill} style={{ width: 66 }} aria-hidden="true" />
              </div>
            </div>
            {/* Subtitle (email) */}
            <div className={styles.bannerBlock} style={{ width: 160, height: 14 }} aria-hidden="true" />
          </div>
        </div>

        {/* Right: header action button outlines */}
        <div className={styles.bannerActions}>
          <div className={styles.bannerBtn} style={{ width: 114 }} aria-hidden="true" />
          <div className={styles.bannerBtn} style={{ width: 72 }} aria-hidden="true" />
          <div className={styles.bannerBtn} style={{ width: 96 }} aria-hidden="true" />
          <div className={styles.bannerBtn} style={{ width: 80 }} aria-hidden="true" />
        </div>
      </div>

      {/* ── 2. NavBar pill-tab bar skeleton ───────────────────── */}
      <div className={styles.navBar}>
        <div className={styles.tabGroup}>
          <SkeletonBlock width={76} height={30} radius="9999px" />
          <SkeletonBlock width={104} height={30} radius="9999px" />
          <SkeletonBlock width={88} height={30} radius="9999px" />
        </div>
      </div>

      {/* ── 3. Detail section cards ────────────────────────────── */}
      <div className={styles.sections}>

        {/* Identity card */}
        <div className={styles.sectionCard}>
          {/* Section title pill */}
          <SkeletonBlock width={72} height={22} radius="9999px" className={styles.sectionTitleSk} />
          {/* 2-column field grid */}
          <div className={styles.fieldGrid}>
            <FieldCardSkeleton valueWidth="38%" />
            <FieldCardSkeleton icon valueWidth="68%" />
            <FieldCardSkeleton icon valueWidth="75%" />
            <FieldCardSkeleton valueWidth="52%" />
            <FieldCardSkeleton valueWidth="42%" />
          </div>
        </div>

        {/* Access card */}
        <div className={styles.sectionCard}>
          <SkeletonBlock width={58} height={22} radius="9999px" className={styles.sectionTitleSk} />
          <div className={styles.fieldGrid}>
            <FieldCardSkeleton icon valueWidth="58%" />
            <FieldCardSkeleton valueWidth="38%" />
            <FieldCardSkeleton valueWidth="28%" />
            <FieldCardSkeleton icon valueWidth="62%" />
            <FieldCardSkeleton icon valueWidth="62%" />
            <FieldCardSkeleton icon valueWidth="62%" />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Sub-component: single field card placeholder ──────────────────
interface FieldCardSkeletonProps {
  icon?: boolean
  valueWidth: string
}

function FieldCardSkeleton({ icon, valueWidth }: FieldCardSkeletonProps) {
  return (
    <div className={styles.fieldCard}>
      {icon && (
        <div className={styles.fieldIconBox} aria-hidden="true" />
      )}
      <div className={styles.fieldBody}>
        {/* Label line */}
        <SkeletonBlock width="52%" height={9} radius="3px" />
        {/* Value line */}
        <SkeletonBlock width={valueWidth} height={13} radius="3px" />
      </div>
    </div>
  )
}
