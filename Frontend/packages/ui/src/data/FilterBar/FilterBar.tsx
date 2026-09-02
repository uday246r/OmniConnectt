import type { ReactNode } from 'react'
import { Icon } from '../../primitives/Icon/Icon'
import { classNames } from '../../utils/classNames'
import styles from './FilterBar.module.css'

export interface ActiveFilter {
  /** Stable identity, usually the column/field key. */
  key: string
  /** Column name, e.g. "Service". */
  label: ReactNode
  /** The value in force. Quoted by the caller if it is free text. */
  value: ReactNode
  onRemove: () => void
}

export interface FilterBarProps {
  filters: ActiveFilter[]
  onClearAll?: () => void
  className?: string
}

/**
 * The readout of what a table is currently filtered by.
 *
 * Renders nothing when no filter is active, so a caller can place it unconditionally above its
 * table. Each chip carries its own ✕; `onClearAll` adds the "Clear all" control — omit it and the
 * chips are still individually removable.
 */
export function FilterBar({ filters, onClearAll, className }: FilterBarProps) {
  if (filters.length === 0) return null

  return (
    <div className={classNames(styles.bar, className)}>
      <span className={styles.label}>Filters:</span>

      {filters.map((f) => (
        <span key={f.key} className={styles.chip}>
          <span className={styles.chipText}>
            {f.label}: {f.value}
          </span>
          <button
            type="button"
            className={styles.chipRemove}
            onClick={f.onRemove}
            aria-label={`Remove ${typeof f.label === 'string' ? f.label : 'this'} filter`}
          >
            <Icon.X width={12} height={12} />
          </button>
        </span>
      ))}

      {onClearAll && (
        <button type="button" className={styles.clearAll} onClick={onClearAll}>
          Clear all
        </button>
      )}
    </div>
  )
}
