import { Icon } from '../../primitives/Icon/Icon'
import { Select } from '../../primitives/Select/Select'
import { classNames } from '../../utils/classNames'
import styles from './Pagination.module.css'

export interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  /** Noun for the summary line, in the SINGULAR, e.g. "user" — an "s" is added for any count but one. */
  itemLabel?: string
  /**
   * The plural, for a noun that does not take a plain "s" — "category" → "categories". Without it a
   * caller either passed the singular and got "categorys", or passed the plural and got "categoriess".
   */
  itemLabelPlural?: string
  /**
   * Supply this to show the rows-per-page control. Omit it and the control is hidden, for tables
   * whose page size is fixed by the caller.
   */
  onPageSizeChange?: (pageSize: number) => void
  pageSizeOptions?: number[]
  /**
   * Hide the whole bar when everything fits on one page. On by default — a pager under a
   * three-row table is noise. Pass false to keep the summary visible regardless.
   */
  hideWhenSinglePage?: boolean
  className?: string
}

const DEFAULT_PAGE_SIZES = [10, 20, 50, 100]

/**
 * The unified pagination bar that sits under every table in the platform.
 *
 * Left:  ● Showing 1 to 10 of 42 leads
 * Right: Per page [10 v]  |  ‹ Previous  |  [ 1 ]  |  Next ›
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  itemLabel = 'item',
  itemLabelPlural,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZES,
  hideWhenSinglePage = true,
  className,
}: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize))

  if (hideWhenSinglePage && totalPages <= 1 && !onPageSizeChange) return null

  // Clamped so an empty result reads "Showing 0 to 0 of 0" rather than "1 to 0".
  const first = total === 0 ? 0 : (page - 1) * pageSize + 1
  const last = Math.min(page * pageSize, total)
  const noun = total === 1 ? itemLabel : (itemLabelPlural ?? `${itemLabel}s`)

  return (
    <nav className={classNames(styles.bar, className)} aria-label="Pagination">
      <div className={styles.summary}>
        <span className={styles.summaryDot} aria-hidden="true" />
        <span className={styles.summaryText}>
          Showing <strong className={styles.summaryNum}>{first}</strong> to{' '}
          <strong className={styles.summaryNum}>{last}</strong> of{' '}
          <strong className={styles.summaryNum}>{total}</strong> {noun}
        </span>
      </div>

      <div className={styles.controls}>
        {onPageSizeChange && (
          <label className={styles.pageSize}>
            <span className={styles.pageSizeLabel}>Per page</span>
            <Select
              size="sm"
              className={styles.pageSizeSelect}
              value={String(pageSize)}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              options={pageSizeOptions.map((n) => ({ value: String(n), label: String(n) }))}
              aria-label="Rows per page"
            />
          </label>
        )}

        <div className={styles.pager}>
          {/* Previous Button */}
          <button
            type="button"
            className={styles.pageBtn}
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
            aria-label="Go to previous page"
          >
            <Icon.ChevronLeft width={13} height={13} />
            <span>Previous</span>
          </button>

          <span className={styles.pageDivider} aria-hidden="true" />

          {/* Single active page indicator */}
          <span
            className={styles.pageNumActive}
            aria-current="page"
            aria-label={`Page ${page} of ${totalPages}`}
          >
            {page}
          </span>

          <span className={styles.pageDivider} aria-hidden="true" />

          {/* Next Button */}
          <button
            type="button"
            className={styles.pageBtn}
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
            aria-label="Go to next page"
          >
            <span>Next</span>
            <Icon.ChevronRight width={13} height={13} />
          </button>
        </div>
      </div>
    </nav>
  )
}
