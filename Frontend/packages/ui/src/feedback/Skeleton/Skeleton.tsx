import type { CSSProperties } from 'react'
import { classNames } from '../../utils/classNames'
import styles from './Skeleton.module.css'

/*
 * Every size below is passed as a CSS custom property rather than an inline declaration. The values
 * are genuinely runtime (a caller picks the height of a placeholder), but the declarations that
 * consume them live in Skeleton.module.css — which is what the repo's no-inline-CSS convention asks
 * for. `as CSSProperties` is needed because React's types do not model custom properties.
 */

function cssVars(vars: Record<string, string | undefined>): CSSProperties | undefined {
  const entries = Object.entries(vars).filter(([, v]) => v !== undefined)
  return entries.length > 0 ? (Object.fromEntries(entries) as CSSProperties) : undefined
}

function toCssSize(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined
  return typeof value === 'number' ? `${value}px` : value
}

export interface SkeletonBlockProps {
  width?: string | number
  height?: string | number
  radius?: string
  className?: string
}

/** A single shimmering rectangle — the primitive the others build on. */
export function SkeletonBlock({ width, height, radius, className }: SkeletonBlockProps) {
  return (
    <div
      className={classNames(styles.shimmer, styles.block, className)}
      style={cssVars({
        '--omni-skeleton-width': toCssSize(width),
        '--omni-skeleton-height': toCssSize(height),
        '--omni-skeleton-radius': radius,
      })}
      aria-hidden="true"
    />
  )
}

export interface SkeletonTextProps {
  lines?: number
  /** The last line is shortened so a paragraph reads as text rather than a solid slab. Ignored for a single line. */
  lastLineWidth?: string
  className?: string
}

export function SkeletonText({ lines = 1, lastLineWidth = '70%', className }: SkeletonTextProps) {
  return (
    <div className={classNames(styles.textGroup, className)} aria-hidden="true">
      {Array.from({ length: lines }, (_, i) => (
        <div
          key={i}
          className={classNames(styles.shimmer, styles.text)}
          style={cssVars({
            '--omni-skeleton-width': i === lines - 1 && lines > 1 ? lastLineWidth : '100%',
          })}
        />
      ))}
    </div>
  )
}

export interface SkeletonAvatarProps {
  size?: number
  className?: string
}

export function SkeletonAvatar({ size, className }: SkeletonAvatarProps) {
  return (
    <div
      className={classNames(styles.shimmer, styles.avatar, className)}
      style={cssVars({ '--omni-skeleton-size': toCssSize(size) })}
      aria-hidden="true"
    />
  )
}

export interface SkeletonTableProps {
  rows?: number
  columns?: number
  className?: string
}

/** Placeholder rows while a table's page loads. Pair with `DataTable` so the chrome stays put. */
export function SkeletonTable({ rows = 5, columns = 4, className }: SkeletonTableProps) {
  return (
    <div className={classNames(styles.table, className)} role="status" aria-label="Loading">
      {Array.from({ length: rows }, (_, r) => (
        <div key={r} className={styles.tableRow}>
          {Array.from({ length: columns }, (_, c) => (
            <div
              key={c}
              className={classNames(styles.shimmer, styles.tableCell, c === 0 && styles.tableCellLead)}
            />
          ))}
        </div>
      ))}
    </div>
  )
}

export interface TableSkeletonProps {
  /** Number of placeholder rows. Match the table's page size so nothing shifts when data lands. */
  rows?: number
  /** Number of columns, or per-column widths (`'40%'`, `120`) for a closer shape match. */
  columns: number | Array<string | number>
  /** Set when the table renders a leading expander column, so the skeleton reserves it too. */
  leadingExpander?: boolean
}

/**
 * Loading rows for a real `<table>`.
 *
 * Renders `<tr>/<td>` INSIDE the caller's `<DataTable>`, so the header, column widths, row height,
 * padding and borders are the table's own — the placeholder occupies exactly the space the data
 * will. `SkeletonTable` above draws a standalone grid of divs, which is right for a card but cannot
 * line up with a table it is not part of.
 *
 * This exists because the remotes replaced their tables with a centred spinner and the words
 * "Loading…" while loading: the page collapsed to one line, then snapped back to full height when
 * data arrived. The host never did that — it has always drawn shape-matched skeletons — which is
 * why loading felt worse in the remotes.
 */
export function TableSkeleton({ rows = 5, columns, leadingExpander }: TableSkeletonProps) {
  const widths = typeof columns === 'number' ? Array.from({ length: columns }, () => undefined) : columns

  return (
    <tbody aria-busy="true">
      {Array.from({ length: rows }, (_, r) => (
        <tr key={r}>
          {leadingExpander && (
            <td>
              <SkeletonBlock width={16} height={16} radius="4px" />
            </td>
          )}
          {widths.map((w, c) => (
            <td key={c}>
              {/* First column carries the row's identity, so it reads a little wider — the same
                  weighting SkeletonTable uses for its lead cell. */}
              <SkeletonBlock width={w ?? (c === 0 ? '70%' : '55%')} height={14} radius="4px" />
            </td>
          ))}
        </tr>
      ))}
    </tbody>
  )
}
