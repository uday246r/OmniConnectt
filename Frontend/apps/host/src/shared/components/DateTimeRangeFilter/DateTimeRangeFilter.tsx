import { useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { classNames, columnFilterStyles } from '@omniremit/ui'
import styles from './DateTimeRangeFilter.module.css'

export interface DateTimeRangeValue {
  /** ISO 8601 instant — the start of the range, inclusive. */
  from?: string
  /** ISO 8601 instant — the end of the range, inclusive. */
  to?: string
}

export interface DateTimeRangeFilterProps {
  /** The column heading, e.g. "LAST LOGIN". Rendered uppercase, matching `ColumnFilter`. */
  label: string
  value: DateTimeRangeValue
  onChange: (value: DateTimeRangeValue) => void
  className?: string
}

function splitIso(iso?: string): { date: string; time: string } {
  if (!iso) return { date: '', time: '' }
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return { date: '', time: '' }
  const pad = (n: number) => String(n).padStart(2, '0')
  return {
    date: `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`,
    time: `${pad(d.getHours())}:${pad(d.getMinutes())}`,
  }
}

/** Combines a date + optional time into an ISO instant. An empty time defaults to the start or end of that day, so "from 3 Sep" and "to 5 Sep" with no time set behave as whole-day bounds. */
function combine(date: string, time: string, endOfDayIfNoTime: boolean): string | undefined {
  if (!date) return undefined
  const t = time || (endOfDayIfNoTime ? '23:59:59' : '00:00:00')
  const d = new Date(`${date}T${t}`)
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString()
}

function formatSummary(value: DateTimeRangeValue): string {
  const fromSplit = splitIso(value.from)
  const toSplit = splitIso(value.to)
  const from = fromSplit.date ? `${fromSplit.date}${fromSplit.time ? ` ${fromSplit.time}` : ''}` : '…'
  const to = toSplit.date ? `${toSplit.date}${toSplit.time ? ` ${toSplit.time}` : ''}` : '…'
  return `${from} → ${to}`
}

/**
 * A column header that filters its column by a date-and-time range — "Last Login" in the Users
 * table, "Time" in the Audit Log. Same trigger/popover chrome as `ColumnFilter` (reuses its exact
 * classes so a mixed row of plain-option and date-range filters looks like one system), but with a
 * bespoke from/to date+time body instead of an option list, since a range has no fixed vocabulary to
 * pick from.
 */
export function DateTimeRangeFilter({ label, value, onChange, className }: DateTimeRangeFilterProps) {
  const [open, setOpen] = useState(false)
  const [fromDate, setFromDate] = useState('')
  const [fromTime, setFromTime] = useState('')
  const [toDate, setToDate] = useState('')
  const [toTime, setToTime] = useState('')
  const rootRef = useRef<HTMLTableCellElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const popoverId = useId()
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      const left = Math.min(rect.left, window.innerWidth - 300)
      setCoords({ top: rect.bottom + 6, left: Math.max(8, left) })
    }
    update()
    window.addEventListener('resize', update)
    window.addEventListener('scroll', update, true)
    return () => {
      window.removeEventListener('resize', update)
      window.removeEventListener('scroll', update, true)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node
      if (!rootRef.current?.contains(t) && !popoverRef.current?.contains(t)) setOpen(false)
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  // Opens showing whatever is currently filtering it, so the range can be edited rather than
  // always starting blank.
  useEffect(() => {
    if (!open) return
    const fromSplit = splitIso(value.from)
    const toSplit = splitIso(value.to)
    setFromDate(fromSplit.date)
    setFromTime(fromSplit.time)
    setToDate(toSplit.date)
    setToTime(toSplit.time)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const isFiltered = Boolean(value.from || value.to)

  function apply() {
    onChange({
      from: combine(fromDate, fromTime, false),
      to: combine(toDate, toTime, true),
    })
    setOpen(false)
  }

  function reset() {
    onChange({})
    setOpen(false)
  }

  return (
    <th ref={rootRef} className={classNames(columnFilterStyles.th, className)}>
      <button
        type="button"
        className={classNames(columnFilterStyles.trigger, isFiltered && columnFilterStyles.triggerActive)}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
      >
        <span>{label}</span>
        <svg
          className={classNames(columnFilterStyles.icon, open && columnFilterStyles.iconOpen)}
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        {isFiltered && <span className={columnFilterStyles.dot} aria-hidden="true" />}
      </button>

      {open && coords && createPortal(
        <div
          ref={popoverRef}
          className={classNames(columnFilterStyles.popover, styles.popover)}
          id={popoverId}
          style={{ top: coords.top, left: coords.left }}
        >
          <div className={columnFilterStyles.header}>
            <span className={columnFilterStyles.title}>Filter {label}</span>
            {isFiltered && (
              <button type="button" className={columnFilterStyles.clearBtn} onClick={reset}>
                Reset
              </button>
            )}
          </div>

          {isFiltered && <p className={styles.currentSummary}>{formatSummary(value)}</p>}

          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>From</span>
            <div className={styles.fieldRow}>
              <input
                type="date"
                className={styles.dateInput}
                value={fromDate}
                max={toDate || undefined}
                onChange={(e) => setFromDate(e.target.value)}
                aria-label={`${label} from date`}
              />
              <input
                type="time"
                className={styles.timeInput}
                value={fromTime}
                disabled={!fromDate}
                onChange={(e) => setFromTime(e.target.value)}
                aria-label={`${label} from time`}
              />
            </div>
          </div>

          <div className={styles.fieldGroup}>
            <span className={styles.fieldLabel}>To</span>
            <div className={styles.fieldRow}>
              <input
                type="date"
                className={styles.dateInput}
                value={toDate}
                min={fromDate || undefined}
                onChange={(e) => setToDate(e.target.value)}
                aria-label={`${label} to date`}
              />
              <input
                type="time"
                className={styles.timeInput}
                value={toTime}
                disabled={!toDate}
                onChange={(e) => setToTime(e.target.value)}
                aria-label={`${label} to time`}
              />
            </div>
          </div>

          <button type="button" className={styles.applyBtn} onClick={apply}>
            Apply
          </button>
        </div>,
        document.body,
      )}
    </th>
  )
}
