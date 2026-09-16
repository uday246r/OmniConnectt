import { classNames } from '../../utils/classNames'
import columnFilterStyles from '../ColumnFilter/ColumnFilter.module.css'
import styles from './DateRange.module.css'
import {
  DATE_RANGE_PRESETS,
  describeDateRange,
  isDateRangeActive,
  type DateRangePreset,
  type DateRangeValue,
} from './dateRange'

export interface DateRangeFieldsProps {
  /** The DRAFT being edited. The parent owns committing it. */
  value: DateRangeValue
  onChange: (value: DateRangeValue) => void
  onApply: () => void
  onReset: () => void
  /** A subset or reordering of the presets. Omit for all of them. */
  presets?: DateRangePreset[]
  /** Hides the two time inputs, for a screen where a whole-day range is the only sensible grain. */
  showTime?: boolean
  /** Prefixes every input's accessible name, e.g. "TIME" gives "TIME from date". */
  label: string
}

/**
 * The body of every date-range control on the platform: the presets, the custom from/to fields, and
 * Apply.
 *
 * @remarks
 * Separated from the chrome around it because the same body appears in two very different places —
 * a column-header popover on the audit tables and a standalone filter-bar button on System Logs.
 * Before this there were three bodies as well as three sets of chrome, and the bodies differed in
 * ways nobody had chosen: one had no reachable time inputs at all, because the state existed and no
 * control ever wrote to it.
 */
export function DateRangeFields({
  value,
  onChange,
  onApply,
  onReset,
  presets,
  showTime = true,
  label,
}: DateRangeFieldsProps) {
  const options = presets
    ? DATE_RANGE_PRESETS.filter((p) => presets.includes(p.key))
    : DATE_RANGE_PRESETS

  const isCustom = value.preset === 'custom'
  const active = isDateRangeActive(value)

  return (
    <>
      <div className={columnFilterStyles.header}>
        <span className={columnFilterStyles.title}>Filter {label}</span>
        {active && (
          <button type="button" className={columnFilterStyles.clearBtn} onClick={onReset}>
            Reset
          </button>
        )}
      </div>

      {active && <p className={styles.currentSummary}>{describeDateRange(value)}</p>}

      <div className={styles.presets} role="group" aria-label={`${label} presets`}>
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            className={classNames(styles.preset, value.preset === option.key && styles.presetActive)}
            aria-pressed={value.preset === option.key}
            onClick={() => onChange({ ...value, preset: option.key })}
          >
            {option.label}
          </button>
        ))}
      </div>

      {/*
        Always rendered, dimmed and inert until Custom is chosen. Hiding them entirely — which is
        what the previous implementations did — meant an operator could not see that a precise range
        was even available until after they had guessed which preset revealed it.
      */}
      <div
        className={classNames(styles.customFields, !isCustom && styles.customFieldsInactive)}
        aria-hidden={!isCustom}
      >
        <div className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>From</span>
          <div className={styles.fieldRow}>
            <input
              type="date"
              className={styles.dateInput}
              value={value.fromDate ?? ''}
              max={value.toDate || undefined}
              disabled={!isCustom}
              onChange={(e) => onChange({ ...value, preset: 'custom', fromDate: e.target.value })}
              aria-label={`${label} from date`}
            />
            {showTime && (
              <input
                type="time"
                className={styles.timeInput}
                value={value.fromTime ?? ''}
                // A time with no date is meaningless, so it stays inert until there is one.
                disabled={!isCustom || !value.fromDate}
                onChange={(e) => onChange({ ...value, preset: 'custom', fromTime: e.target.value })}
                aria-label={`${label} from time`}
              />
            )}
          </div>
        </div>

        <div className={styles.fieldGroup}>
          <span className={styles.fieldLabel}>To</span>
          <div className={styles.fieldRow}>
            <input
              type="date"
              className={styles.dateInput}
              value={value.toDate ?? ''}
              min={value.fromDate || undefined}
              disabled={!isCustom}
              onChange={(e) => onChange({ ...value, preset: 'custom', toDate: e.target.value })}
              aria-label={`${label} to date`}
            />
            {showTime && (
              <input
                type="time"
                className={styles.timeInput}
                value={value.toTime ?? ''}
                disabled={!isCustom || !value.toDate}
                onChange={(e) => onChange({ ...value, preset: 'custom', toTime: e.target.value })}
                aria-label={`${label} to time`}
              />
            )}
          </div>
        </div>
      </div>

      <button type="button" className={styles.applyBtn} onClick={onApply}>
        Apply
      </button>
    </>
  )
}
