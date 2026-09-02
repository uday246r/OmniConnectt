import { useEffect, useId, useState } from 'react'
import { Select } from '../../primitives/Select/Select'
import { classNames } from '../../utils/classNames'
import styles from './RowsPerPage.module.css'

export interface RowsPerPageProps {
  value: number
  onChange: (pageSize: number) => void
  /** Preset sizes. The platform default matches the host's Audit Logs. */
  options?: number[]
  /**
   * Persist the choice under this key so the table opens at the size the user picked last time.
   * Omit it and the control is session-only. Use one key per table, e.g. `lead.audit`.
   */
  storageKey?: string
  className?: string
}

const DEFAULT_OPTIONS = [5, 10, 15, 20]
const MIN_ROWS = 1
const MAX_ROWS = 500
const STORAGE_PREFIX = 'omni.rowsPerPage.'

/** Reads a remembered size. Wrapped because storage throws outright in some privacy modes. */
export function readStoredPageSize(storageKey: string | undefined, fallback: number): number {
  if (!storageKey) return fallback
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + storageKey)
    const parsed = raw === null ? NaN : parseInt(raw, 10)
    return Number.isNaN(parsed) || parsed < MIN_ROWS || parsed > MAX_ROWS ? fallback : parsed
  } catch {
    return fallback
  }
}

/**
 * How many rows a table shows at once.
 *
 * Lives in the table's toolbar, labelled "ROWS", following the host's Audit Logs.
 *
 * PRESETS + CUSTOM, matching that page: 5 / 10 / 15 / 20 and a free number. Choosing Custom
 * reveals an input rather than replacing the select, so the presets stay one click away.
 *
 * REMEMBERED. Given a `storageKey`, the choice survives navigation and reload — a user who works
 * at 50 rows had to reset every table on every visit, on every screen, because each one reverted
 * to its own hardcoded default. Persistence is per table, since a comfortable size for an audit
 * trail is not necessarily right for a six-column directory.
 */
export function RowsPerPage({
  value,
  onChange,
  options = DEFAULT_OPTIONS,
  storageKey,
  className,
}: RowsPerPageProps) {
  const id = useId()
  const isPreset = options.includes(value)
  const [isCustom, setIsCustom] = useState(!isPreset)
  const [customInput, setCustomInput] = useState(isPreset ? '' : String(value))

  // A value set elsewhere (a Reset, a remembered size loading in) keeps the control honest.
  useEffect(() => {
    if (options.includes(value)) {
      setIsCustom(false)
    } else {
      setIsCustom(true)
      setCustomInput(String(value))
    }
  }, [value, options])

  function persist(size: number) {
    if (!storageKey) return
    try {
      window.localStorage.setItem(STORAGE_PREFIX + storageKey, String(size))
    } catch {
      /* Storage unavailable (private mode, blocked site data) — the size still applies for now. */
    }
  }

  function commit(size: number) {
    onChange(size)
    persist(size)
  }

  function handleSelect(next: string) {
    if (next === 'custom') {
      setIsCustom(true)
      setCustomInput(String(value))
      return
    }
    setIsCustom(false)
    setCustomInput('')
    commit(Number(next))
  }

  function handleCustomInput(raw: string) {
    setCustomInput(raw)
    const parsed = parseInt(raw, 10)
    if (!Number.isNaN(parsed) && parsed >= MIN_ROWS && parsed <= MAX_ROWS) commit(parsed)
  }

  return (
    <div className={classNames(styles.wrap, className)}>
      <label htmlFor={id} className={styles.label}>
        Rows
      </label>

      <Select
        id={id}
        size="sm"
        className={styles.select}
        value={isCustom ? 'custom' : String(value)}
        onChange={(e) => handleSelect(e.target.value)}
        options={[
          ...options.map((n) => ({ value: String(n), label: String(n) })),
          { value: 'custom', label: 'Custom' },
        ]}
        aria-label="Rows per page"
      />

      {isCustom && (
        <input
          type="number"
          min={MIN_ROWS}
          max={MAX_ROWS}
          className={styles.customInput}
          value={customInput}
          placeholder="e.g. 50"
          aria-label="Custom rows per page"
          onChange={(e) => handleCustomInput(e.target.value)}
          onBlur={() => {
            // Snap an out-of-range or empty entry back to what is actually in force.
            const parsed = parseInt(customInput, 10)
            if (Number.isNaN(parsed) || parsed < MIN_ROWS || parsed > MAX_ROWS) {
              setCustomInput(String(value))
            }
          }}
          autoFocus
        />
      )}
    </div>
  )
}
