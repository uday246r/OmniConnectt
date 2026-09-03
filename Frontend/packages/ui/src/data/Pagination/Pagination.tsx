import { Icon } from '../../primitives/Icon/Icon'
import { Select } from '../../primitives/Select/Select'
import { classNames } from '../../utils/classNames'
import styles from './Pagination.module.css'

export interface PaginationProps {
  page: number
  pageSize: number
  total: number
  onPageChange: (page: number) => void
  /** Noun for the summary line, e.g. "user" — pluralised automatically. */
  itemLabel?: string
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
 * The pager that sits under every table.
 *
 * There were TEN separate implementations of this across the three apps — the host's Audit Logs
 * and Approval Center, My Requests, both remotes' audit logs, the Lead Directory, the two
 * customer360 list pages, the lead diff table and the c360 profile tables — and they disagreed on
 * nearly everything: some showed "Showing 1 to 10 of 42 records", some only "Page 2 of 5", some a
 * rows-per-page select, some bare `<` `>` glyphs, some the words Previous/Next. This carries the
 * union so no caller has to rebuild it:
 *
 *   left    Showing 1 to 10 of 42 leads
 *   right   Per page [10 v]   ‹ Previous   Page 1 of 5   Next ›
 *
 * The arrows are labelled rather than bare chevrons: an icon-only control at the end of a long
 * table gives no hint which direction it moves, and the host's Audit Logs — the reference — spells
 * them out.
 */
export function Pagination({
  page,
  pageSize,
  total,
  onPageChange,
  itemLabel = 'item',
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
  const plural = total === 1 ? '' : 's'

  return (
    <nav className={classNames(styles.bar, className)} aria-label="Pagination">
      <p className={styles.summary}>
        Showing <strong>{first}</strong> to <strong>{last}</strong> of <strong>{total}</strong>{' '}
        {itemLabel}
        {plural}
      </p>

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
          <button
            type="button"
            className={styles.pageBtn}
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            <Icon.ChevronLeft width={14} height={14} />
            <span>Previous</span>
          </button>

          <span className={styles.indicator}>
            Page <strong>{page}</strong> of <strong>{totalPages}</strong>
          </span>

          <button
            type="button"
            className={styles.pageBtn}
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            <span>Next</span>
            <Icon.ChevronRight width={14} height={14} />
          </button>
        </div>
      </div>
    </nav>
  )
}
