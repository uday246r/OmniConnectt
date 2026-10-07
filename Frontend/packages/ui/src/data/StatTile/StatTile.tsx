import type { ReactNode } from 'react'
import { classNames } from '../../utils/classNames'
import styles from './StatTile.module.css'

export type StatTileAccent = 'primary' | 'success' | 'warning' | 'info' | 'danger'

export interface StatTileProps {
  label: string
  /** A number is grouped in the reader's own locale. Anything else is rendered as given. */
  value: ReactNode
  icon: ReactNode
  accent?: StatTileAccent
  /** The change against an earlier date, as a percentage. Omit for a figure with no comparison. */
  changePercent?: number
  /** What the change is measured against, e.g. "vs last 30 days". */
  changeLabel?: string
  /** A quiet note in the corner — a qualifier the headline figure needs. */
  caption?: string
  className?: string
}

/** "+12%", "−4.5%", "0%": signed, at most one decimal, in the reader's locale. */
function formatChange(percent: number): string {
  const rounded = Math.round(percent * 10) / 10
  const text = `${new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 }).format(Math.abs(rounded))}%`
  return rounded > 0 ? `+${text}` : rounded < 0 ? `−${text}` : text
}

/**
 * One headline figure: an icon, its name, its value and how it has moved.
 *
 * Promoted from the marketplace, which had the only real component for this. Every host page
 * hand-rolls the same thing as a local `.summaryCard` / `.summaryValue` pair in its own stylesheet,
 * which is why the number is a slightly different size on every screen that shows one.
 */
export function StatTile({
  label,
  value,
  icon,
  accent = 'primary',
  changePercent,
  changeLabel,
  caption,
  className,
}: StatTileProps) {
  const direction =
    changePercent === undefined || changePercent === 0 ? 'flat' : changePercent > 0 ? 'up' : 'down'

  return (
    <article className={classNames(styles.tile, styles[accent], className)} aria-label={label}>
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden="true">
          {icon}
        </span>
        <div className={styles.numbers}>
          <span className={styles.label}>{label}</span>
          <span className={styles.value}>
            {typeof value === 'number' ? new Intl.NumberFormat().format(value) : value}
          </span>
        </div>
      </div>
      {(changePercent !== undefined || caption) && (
        <div className={styles.foot}>
          {changePercent !== undefined && (
            <span className={classNames(styles.change, styles[direction])}>
              <span aria-hidden="true">
                {direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→'}
              </span>
              <strong>{formatChange(changePercent)}</strong>
              {changeLabel && <span className={styles.changeLabel}>{changeLabel}</span>}
            </span>
          )}
          {caption && <span className={styles.caption}>{caption}</span>}
        </div>
      )}
    </article>
  )
}
