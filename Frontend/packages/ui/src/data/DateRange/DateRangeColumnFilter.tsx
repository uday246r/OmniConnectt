import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { classNames } from '../../utils/classNames'
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover'
import columnFilterStyles from '../ColumnFilter/ColumnFilter.module.css'
import styles from './DateRange.module.css'
import { DateRangeFields } from './DateRangeFields'
import { EMPTY_DATE_RANGE, isDateRangeActive, type DateRangePreset, type DateRangeValue } from './dateRange'

export interface DateRangeColumnFilterProps {
  /** The column heading, e.g. "TIME". Rendered uppercase to match the other column filters. */
  label: string
  value: DateRangeValue
  onChange: (value: DateRangeValue) => void
  presets?: DateRangePreset[]
  showTime?: boolean
  className?: string
}

/**
 * A table column header that filters its column by a date range.
 *
 * @remarks
 * Renders the `<th>` itself and reuses `ColumnFilter`'s exact trigger and popover classes, so a
 * header row mixing option filters and this one reads as a single system rather than as two
 * components that happen to sit next to each other.
 *
 * Replaces the host-only `DateTimeRangeFilter`, which could not be used by either remote — it lived
 * in the host's own `src/shared/`, so the two audit screens that most needed a date filter had none.
 */
export function DateRangeColumnFilter({
  label,
  value,
  onChange,
  presets,
  showTime = true,
  className,
}: DateRangeColumnFilterProps) {
  const { open, setOpen, anchorRef, popoverRef, coords, popoverId } =
    useAnchoredPopover<HTMLTableCellElement>({ minWidth: 300 })

  // The popover edits a draft, so a half-typed range never reaches the query and an abandoned edit
  // leaves the applied filter untouched.
  const [draft, setDraft] = useState<DateRangeValue>(value)

  // Opens showing whatever is currently applied, so a range can be adjusted rather than retyped.
  useEffect(() => {
    if (open) setDraft(value)
  }, [open, value])

  const active = isDateRangeActive(value)

  function apply() {
    onChange(draft)
    setOpen(false)
  }

  function reset() {
    setDraft(EMPTY_DATE_RANGE)
    onChange(EMPTY_DATE_RANGE)
    setOpen(false)
  }

  return (
    <th ref={anchorRef} className={classNames(columnFilterStyles.th, className)}>
      <button
        type="button"
        className={classNames(columnFilterStyles.trigger, active && columnFilterStyles.triggerActive)}
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
        {active && <span className={columnFilterStyles.dot} aria-hidden="true" />}
      </button>

      {open && coords && createPortal(
        <div
          ref={popoverRef}
          className={classNames(columnFilterStyles.popover, styles.popover)}
          id={popoverId}
          style={{ top: coords.top, left: coords.left }}
        >
          <DateRangeFields
            value={draft}
            onChange={setDraft}
            onApply={apply}
            onReset={reset}
            presets={presets}
            showTime={showTime}
            label={label}
          />
        </div>,
        document.body,
      )}
    </th>
  )
}
