import { classNames } from '../../utils/classNames'
import { SkeletonAvatar, SkeletonBlock } from './Skeleton'
import styles from './SkeletonComposites.module.css'

/*
 * Placeholders shaped like the shared component each one stands in for.
 *
 * The primitives in Skeleton.tsx draw a grey rectangle, and what made loading feel unfinished in the
 * remotes was that a rectangle was all they drew — one 320px slab where a form would be, another
 * where a chart would be. The host has always drawn the THING that is coming: a card with a title
 * line and field rows, a ring with a legend beside it. These do the same for the pieces this package
 * owns (FormSection + FormGrid, DetailSections, a chart panel, a feed row), so the layout is already
 * right before the data is, and nothing jumps when it lands.
 */

export interface SkeletonFormProps {
  /** Number of section cards. */
  sections?: number
  /** Fields in each section, laid out two to a row as FormGrid does. */
  fieldsPerSection?: number
  className?: string
}

/** A form that is still loading: FormSection cards, each a title rule over a grid of label + input. */
export function SkeletonForm({ sections = 2, fieldsPerSection = 4, className }: SkeletonFormProps) {
  return (
    <div className={classNames(styles.formStack, className)} role="status" aria-label="Loading form">
      {Array.from({ length: sections }, (_, s) => (
        <div key={s} className={styles.formCard}>
          <div className={styles.formTitle}>
            <SkeletonBlock width={s % 2 === 0 ? 148 : 112} height={12} radius="4px" />
          </div>
          <div className={styles.formGrid}>
            {Array.from({ length: fieldsPerSection }, (_, f) => (
              <div key={f} className={styles.formField}>
                <SkeletonBlock width={f % 3 === 0 ? '42%' : '30%'} height={10} radius="4px" />
                <SkeletonBlock width="100%" height={46} radius="var(--omni-radius-lg)" />
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export interface SkeletonDetailProps {
  sections?: number
  fieldsPerSection?: number
  className?: string
}

/** A detail drawer that is still loading: DetailSection cards holding icon + label + value tiles. */
export function SkeletonDetail({ sections = 2, fieldsPerSection = 4, className }: SkeletonDetailProps) {
  return (
    <div className={classNames(styles.detailStack, className)} role="status" aria-label="Loading details">
      {Array.from({ length: sections }, (_, s) => (
        <div key={s} className={styles.detailCard}>
          <SkeletonBlock width={96} height={10} radius="4px" />
          <div className={styles.detailGrid}>
            {Array.from({ length: fieldsPerSection }, (_, f) => (
              <div key={f} className={styles.detailField}>
                <SkeletonBlock width={30} height={30} radius="var(--omni-radius-md)" className={styles.fixed} />
                <div className={styles.detailText}>
                  <SkeletonBlock width="46%" height={9} radius="4px" />
                  <SkeletonBlock width={f % 2 === 0 ? '78%' : '60%'} height={12} radius="4px" />
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}

export interface SkeletonChartProps {
  /** `bars` for a column chart, `donut` for a ring with its legend, `line` for a trend. */
  variant?: 'bars' | 'donut' | 'line'
  className?: string
}

/* Fixed, not random: a skeleton that reshuffles on every render flickers, and the same silhouette
   every time is what lets the eye read it as "a chart" rather than as noise. */
const BAR_HEIGHTS = ['46%', '72%', '58%', '88%', '40%', '66%', '52%', '78%']
const LEGEND_WIDTHS = ['64%', '48%', '56%', '40%']

/**
 * A chart that is still loading, drawn as the silhouette of the chart that is coming.
 *
 * It fills its container's height — give the wrapper the real chart's height (most panels already
 * have one) and the panel does not resize when the chart arrives.
 */
export function SkeletonChart({ variant = 'bars', className }: SkeletonChartProps) {
  if (variant === 'donut') {
    return (
      <div className={classNames(styles.chartDonut, className)} role="status" aria-label="Loading chart">
        <SkeletonBlock width={148} height={148} radius="50%" className={styles.donutRing} />
        <div className={styles.donutLegend}>
          {LEGEND_WIDTHS.map((w, i) => (
            <div key={i} className={styles.donutLegendRow}>
              <SkeletonBlock width={10} height={10} radius="3px" className={styles.fixed} />
              <SkeletonBlock width={w} height={10} radius="4px" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  return (
    <div className={classNames(styles.chartPlot, className)} role="status" aria-label="Loading chart">
      <div className={styles.chartGridLines} aria-hidden="true">
        <span />
        <span />
        <span />
        <span />
      </div>
      {variant === 'line' ? (
        <svg className={styles.chartLine} viewBox="0 0 400 100" preserveAspectRatio="none" aria-hidden="true">
          <path d="M0,78 C40,70 60,40 100,46 S160,82 200,58 S270,18 310,34 S370,60 400,28" />
        </svg>
      ) : (
        <div className={styles.chartBars}>
          {BAR_HEIGHTS.map((h, i) => (
            <SkeletonBlock key={i} width="100%" height={h} radius="6px 6px 2px 2px" className={styles.chartBar} />
          ))}
        </div>
      )}
    </div>
  )
}

export interface SkeletonListProps {
  /** Number of rows. */
  rows?: number
  /** The mark each row starts with, as an activity feed (dot) or a people list (avatar) has. */
  leading?: 'none' | 'dot' | 'avatar'
  className?: string
}

/** A feed or list that is still loading: a leading mark and two lines per row. */
export function SkeletonList({ rows = 5, leading = 'dot', className }: SkeletonListProps) {
  return (
    <div className={classNames(styles.list, className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className={styles.listRow}>
          {leading === 'avatar' && <SkeletonAvatar size={32} />}
          {leading === 'dot' && <SkeletonBlock width={8} height={8} radius="50%" className={styles.listDot} />}
          <div className={styles.listText}>
            <SkeletonBlock width={r % 2 === 0 ? '72%' : '58%'} height={12} radius="4px" />
            <SkeletonBlock width="34%" height={9} radius="4px" />
          </div>
        </div>
      ))}
    </div>
  )
}
