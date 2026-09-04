import type { CSSProperties, ReactNode } from 'react'
import { classNames } from '../../utils/classNames'
import styles from './DataTable.module.css'

export interface DataTableProps {
  children: ReactNode
  /**
   * Smallest width before the container scrolls horizontally. Every table in the platform set this
   * itself (720px in Audit Logs, 760px in Approval Center), which was the only real difference
   * between two otherwise byte-identical stylesheets.
   */
  minWidth?: number
  /** Reserves 420px of height so paging through results does not make the page jump. Off by default: a short list should not sit in a tall empty box. */
  reserveHeight?: boolean
  /**
   * Drops the outer card chrome (border, radius, shadow) while keeping the table's own typography,
   * row rhythm and hover. Use when the table is nested inside something that already draws a card,
   * so the two borders do not double up.
   */
  bare?: boolean
  /**
   * Renders a footer (Pagination) inside the card boundary, attached to the table bottom.
   * When provided, the card's bottom radius is removed from the scroll area and the footer
   * element renders below the table with the bottom radius instead.
   */
  footer?: ReactNode
  className?: string
}

/**
 * The platform's table chrome — scroll container, header gradient, row rhythm, hover and empty
 * state. Column markup stays with the feature that owns it.
 *
 * Composition rather than a column-config API is deliberate. Every table in this repo already
 * hand-writes its `<thead>`/`<tbody>`, and several render genuinely bespoke cells (avatar + name
 * stacks, diff summaries, action menus). A `columns={[...]}` API would force all of that through a
 * renderer indirection and turn a styling refactor into a rewrite of eleven tables. Feeding the
 * existing markup through shared chrome gets the consistency with none of that risk.
 *
 * `dataTableStyles` is exported for the cells themselves — see the Empty helper below, and use
 * `dataTableStyles.actionsCell` for a right-aligned action cluster.
 */
export function DataTable({ children, minWidth, reserveHeight, bare, footer, className }: DataTableProps) {
  return (
    <div
      className={classNames(
        styles.container,
        bare && styles.bare,
        reserveHeight && styles.minHeight,
        Boolean(footer) && styles.hasFooter,
        className,
      )}
    >
      <div
        className={styles.scrollArea}
        style={minWidth ? ({ '--omni-data-table-min-width': `${minWidth}px` } as CSSProperties) : undefined}
      >
        <table className={styles.table}>
          {children}
        </table>
      </div>
      {footer != null && (
        <div className={styles.footer}>{footer}</div>
      )}
    </div>
  )
}

export interface DataTableEmptyProps {
  /** Must match the table's column count, or the message will not span the full width. */
  colSpan: number
  children: ReactNode
}

/**
 * The "no rows" row. Standardised because the same construct was written out per feature with
 * three different paddings and two different greys.
 */
export function DataTableEmpty({ colSpan, children }: DataTableEmptyProps) {
  return (
    <tr>
      <td colSpan={colSpan} className={styles.emptyCell}>
        {children}
      </td>
    </tr>
  )
}

/** Exports for cells that need to reach into the table's own styles (e.g. action button clusters). */
export { styles as dataTableStyles }
