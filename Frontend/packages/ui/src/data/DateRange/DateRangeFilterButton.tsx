import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { classNames } from '../../utils/classNames'
import { useAnchoredPopover } from '../../hooks/useAnchoredPopover'
import columnFilterStyles from '../ColumnFilter/ColumnFilter.module.css'
import styles from './DateRange.module.css'
import { DateRangeFields } from './DateRangeFields'
import {
  EMPTY_DATE_RANGE,
  describeDateRange,
  isDateRangeActive,
  type DateRangePreset,
  type DateRangeValue,
} from './dateRange'

export interface DateRangeFilterButtonProps {
  /** Shown on the button when no range is applied. */
  label?: string
  value: DateRangeValue
  onChange: (value: DateRangeValue) => void
  presets?: DateRangePreset[]
  showTime?: boolean
  className?: string
}

/**
 * A standalone date-range control for a filter bar, for screens whose date filter does not belong to
 * a table column.
 *
 * @remarks
 * The same body as {@link DateRangeColumnFilter}, in different chrome. Both placements exist because
 * both are genuinely in use — the audit tables filter a Time COLUMN, while System Logs and the
 * Approval Center filter the whole view from a bar above it — and letting them share only a
 * convention rather than an implementation is exactly how the three previous versions drifted apart.
 *
 * The button shows the applied range rather than a generic label, so an operator can see what is
 * filtering the view without opening anything.
 */
export function DateRangeFilterButton({
  label = 'Date Range',
  value,
  onChange,
  presets,
  showTime = true,
  className,
}: DateRangeFilterButtonProps) {
  const { open, setOpen, anchorRef, popoverRef, coords, popoverId } =
    useAnchoredPopover<HTMLDivElement>({ minWidth: 300 })

  const [draft, setDraft] = useState<DateRangeValue>(value)

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
    <div ref={anchorRef} className={classNames(styles.buttonRoot, className)}>
      <button
        type="button"
        className={classNames(styles.button, active && styles.buttonActive)}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
        /*
         * The visible text becomes the applied range, which is right for sighted scanning and wrong
         * for anything that identifies a control by its name: the button's accessible name would
         * change every time the filter did, so nothing could refer to it stably. The label stays in
         * the name, with the current value after it.
         */
        aria-label={active ? `${label}: ${describeDateRange(value)}` : label}
      >
        <span>{active ? describeDateRange(value) : label}</span>
        <svg
          className={classNames(styles.buttonChevron, open && styles.buttonChevronOpen)}
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
    </div>
  )
}
