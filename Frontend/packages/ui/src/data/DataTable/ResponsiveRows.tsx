import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { SkeletonBlock } from '../../feedback/Skeleton/Skeleton'
import { classNames } from '../../utils/classNames'
import styles from './DataTable.module.css'

/**
 * How readily a column may be dropped when the table runs out of room.
 *
 *   'always'  never hidden — the identity of the row, and the actions on it
 *   'high'    hidden only on the narrowest screens
 *   'low'     the first to go
 */
export type ColumnPriority = 'always' | 'high' | 'low'

export interface ResponsiveColumn<Row> {
  key: string
  /** Header text. Also the label used when the value moves into the expanded panel. */
  label: ReactNode
  priority?: ColumnPriority
  render: (row: Row, index: number) => ReactNode
  /** Replaces the plain `<th>` — pass a `<ColumnFilter …/>` to make the column filterable. */
  header?: ReactNode
  /** Right-align, for an actions column. */
  align?: 'left' | 'right'
  /**
   * Clamp this column's content to two lines with an ellipsis.
   *
   * Opt-in, because clamping needs `display: -webkit-box`, which would override the display of a
   * Badge or status pill and stretch its background across the whole column. Set it only on
   * columns carrying long free text — a description, a reason, a user agent.
   */
  clamp?: boolean
}

export interface ResponsiveRowsProps<Row> {
  columns: ResponsiveColumn<Row>[]
  rows: Row[]
  rowKey: (row: Row, index: number) => string
  /** Rendered in place of the rows when `rows` is empty. */
  empty?: ReactNode
  /**
   * Draw placeholder rows instead of data.
   *
   * The skeleton is derived from the SAME column definitions, so it lands in exactly the columns
   * the data will occupy — including which ones are currently hidden by priority. A caller cannot
   * get the shape wrong, because it is not describing the shape twice.
   */
  loading?: boolean
  /** Placeholder row count while loading. Match the page size so nothing shifts when data lands. */
  loadingRows?: number
  /** Optional DOM `id` for the row element, for pages that scroll to or deep-link a row. */
  rowId?: (row: Row, index: number) => string | undefined
}

/** Widths at which each priority stops being shown. Mirrors the platform breakpoints. */
const HIDE_BELOW: Record<ColumnPriority, number> = {
  always: 0,
  high: 640,
  low: 1000,
}

function useViewportWidth(): number {
  const [width, setWidth] = useState(() =>
    typeof window === 'undefined' ? 1440 : window.innerWidth
  )
  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [])
  return width
}

/**
 * Priority columns with a row expander.
 *
 * As the viewport narrows, low-priority columns drop out of the row and every affected row grows a
 * chevron that reveals them underneath, labelled. Nothing is ever unreachable and the table never
 * has to scroll sideways.
 *
 * Opt-in, and additive: `DataTable` still accepts hand-written `<thead>`/`<tbody>` children, which
 * is what all the existing tables use. A table adopts this by passing `columns`/`rows` instead —
 * one at a time, with no flag day. That matters because several tables render genuinely bespoke
 * cells (avatar stacks, diff summaries, action menus), and `render` keeps that freedom.
 *
 * The visual treatment is the one the host's Audit Logs already defined for this interaction before
 * it was replaced by a separate viewer.
 */
export function ResponsiveRows<Row>({
  columns,
  rows,
  rowKey,
  empty,
  loading,
  loadingRows = 5,
  rowId,
}: ResponsiveRowsProps<Row>) {
  const width = useViewportWidth()
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const headRef = useRef<HTMLTableSectionElement>(null)

  /*
   * The viewport breakpoints alone cannot keep the promise above: a table inside a page with a
   * sidebar and padding has far less room than the window, and at a common 1366–1440px laptop width
   * the user Audit Log table overflowed by ~90px — with its Details action in the part scrolled out
   * of view. So, after the breakpoints, the table also checks the room it actually has: if it still
   * overflows, it drops the 'low' columns into the expander, then the 'high' ones. Measured before
   * paint, so there is no visible reflow; reset whenever the window or the rows change.
   */
  const [squeeze, setSqueeze] = useState(0)
  useLayoutEffect(() => {
    setSqueeze(0)
  }, [width, rows, loading])
  useLayoutEffect(() => {
    const area = headRef.current?.closest('table')?.parentElement
    if (area && squeeze < 2 && area.scrollWidth > area.clientWidth + 1) setSqueeze((s) => s + 1)
  })

  const fits = (priority: ColumnPriority) =>
    squeeze === 0 || priority === 'always' || (squeeze === 1 && priority === 'high')
  const isVisible = (c: ResponsiveColumn<Row>) => {
    const priority = c.priority ?? 'always'
    return width >= HIDE_BELOW[priority] && fits(priority)
  }
  const visible = columns.filter(isVisible)
  const hidden = columns.filter((c) => !isVisible(c))
  const canExpand = hidden.length > 0

  // Collapse everything when the hidden set empties, so widening the window does not leave
  // expanded panels showing nothing.
  useEffect(() => {
    if (!canExpand) setExpanded(new Set())
  }, [canExpand])

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (!next.delete(key)) next.add(key)
      return next
    })
  }

  const colSpan = visible.length + (canExpand ? 1 : 0)

  return (
    <>
      <thead ref={headRef}>
        <tr>
          {canExpand && <th className={styles.expanderHead} aria-label="Expand row" />}
          {visible.map((c) =>
            c.header ? (
              // Wrapped so a caller-supplied header never has to carry its own key.
              <Fragment key={c.key}>{c.header}</Fragment>
            ) : (
              <th key={c.key} className={c.align === 'right' ? styles.thRight : undefined}>
                {c.label}
              </th>
            )
          )}
        </tr>
      </thead>

      <tbody aria-busy={loading || undefined}>
        {loading ? (
          Array.from({ length: loadingRows }, (_, r) => (
            <tr key={`skeleton-${r}`}>
              {canExpand && (
                <td className={styles.expanderCell}>
                  <SkeletonBlock width={16} height={16} radius="4px" />
                </td>
              )}
              {visible.map((c, i) => (
                <td key={c.key} className={c.align === 'right' ? styles.thRight : undefined}>
                  <SkeletonBlock width={i === 0 ? '70%' : '55%'} height={14} radius="4px" />
                </td>
              ))}
            </tr>
          ))
        ) : rows.length === 0 ? (
          <tr>
            <td colSpan={colSpan} className={styles.emptyCell}>
              {empty ?? 'No records found.'}
            </td>
          </tr>
        ) : (
          rows.map((row, i) => {
            const key = rowKey(row, i)
            const isOpen = expanded.has(key)

            return (
              <Fragment key={key}>
                <tr id={rowId?.(row, i)} className={isOpen ? styles.rowExpanded : undefined}>
                  {canExpand && (
                    <td className={styles.expanderCell}>
                      <button
                        type="button"
                        className={classNames(styles.expandChevron, isOpen && styles.expandChevronOpen)}
                        onClick={() => toggle(key)}
                        aria-expanded={isOpen}
                        aria-label={isOpen ? 'Hide extra columns' : 'Show extra columns'}
                      >
                        {/* An SVG rather than a › glyph: the text character sits off-centre in its
                            box and turns into an unreadable hook once rotated 90deg. */}
                        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                          <path
                            d="M6 3.5 10.5 8 6 12.5"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                          />
                        </svg>
                      </button>
                    </td>
                  )}
                  {visible.map((c) => (
                    <td key={c.key} className={c.align === 'right' ? styles.thRight : undefined}>
                      {c.clamp ? (
                        <span className={styles.cellClamp}>{c.render(row, i)}</span>
                      ) : (
                        c.render(row, i)
                      )}
                    </td>
                  ))}
                </tr>

                {isOpen && (
                  <tr className={styles.expandedRow}>
                    <td colSpan={colSpan} className={styles.expandedCell}>
                      <dl className={styles.expandedList}>
                        {hidden.map((c) => (
                          <div key={c.key} className={styles.expandedItem}>
                            <dt className={styles.expandedLabel}>{c.label}</dt>
                            <dd className={styles.expandedValue}>{c.render(row, i)}</dd>
                          </div>
                        ))}
                      </dl>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })
        )}
      </tbody>
    </>
  )
}
