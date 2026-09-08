import { useEffect, useRef, useState, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react'
import { classNames } from '../../utils/classNames'
import styles from './SearchField.module.css'

export interface SearchFieldSuggestion {
  /** Unique key AND the value committed on selection unless `onSelectSuggestion` says otherwise. */
  id: string
  label: ReactNode
}

export interface SearchFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size' | 'onChange' | 'value'> {
  value: string
  /** Receives the new text directly, not the event — every call site only wanted the string. */
  onValueChange: (value: string) => void
  size?: 'sm' | 'md'
  /** Show the ✕ button once there is text. On by default. */
  clearable?: boolean
  /** Override the leading glyph. Defaults to a magnifier. */
  icon?: ReactNode
  className?: string
  /**
   * Caller-computed matches shown in a dropdown as the operator types — the same "recommend as you
   * type" behaviour the Name/Mobile column filters and the Users toolbar search already have.
   * `undefined` (the default) means "no suggestions": the field behaves exactly as before, a plain
   * debounced filter with no dropdown. Passing an array — even an empty one — opts in; an empty
   * array then renders `emptyHint` rather than nothing, so the operator knows the search actually ran.
   */
  suggestions?: SearchFieldSuggestion[]
  /** Fires when a suggestion is picked (click, or Enter while one is highlighted). */
  onSelectSuggestion?: (suggestion: SearchFieldSuggestion) => void
  /** Shows a "Searching…" row in place of the list while the caller's own lookup is in flight. */
  suggestionsLoading?: boolean
  /** Shown when `suggestions` is an empty array and the field has text. */
  emptyHint?: ReactNode
}

function MagnifierIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="7" />
      <line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
  )
}

function ClearIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  )
}

/** The platform search box: icon, input, and a clear button once there is something to clear. */
export function SearchField({
  value,
  onValueChange,
  size = 'md',
  clearable = true,
  icon,
  className,
  placeholder = 'Search…',
  suggestions,
  onSelectSuggestion,
  suggestionsLoading,
  emptyHint = 'No matches.',
  onFocus,
  onBlur,
  ...rest
}: SearchFieldProps) {
  const showClear = clearable && value.length > 0
  const hasSuggestions = suggestions !== undefined
  const [open, setOpen] = useState(false)
  const [highlighted, setHighlighted] = useState(-1)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // Re-aim the highlight whenever the list itself changes, so an old index doesn't point at an
  // unrelated row after the operator types another character.
  useEffect(() => {
    setHighlighted(-1)
  }, [suggestions])

  useEffect(() => {
    if (!hasSuggestions || !open) return
    function handleClickOutside(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [hasSuggestions, open])

  function pick(s: SearchFieldSuggestion) {
    onSelectSuggestion ? onSelectSuggestion(s) : onValueChange(s.id)
    setOpen(false)
  }

  function handleKeyDown(e: KeyboardEvent<HTMLInputElement>) {
    if (!hasSuggestions || !open || !suggestions || suggestions.length === 0) return
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlighted((h) => (h + 1) % suggestions.length)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlighted((h) => (h - 1 + suggestions.length) % suggestions.length)
    } else if (e.key === 'Enter' && highlighted >= 0) {
      e.preventDefault()
      pick(suggestions[highlighted])
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  const showPopover = hasSuggestions && open && value.trim().length > 0

  return (
    <div className={classNames(styles.wrap, className)} ref={hasSuggestions ? wrapRef : undefined}>
      <input
        type="text"
        className={classNames(styles.input, styles[size], showClear && styles.clearable)}
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value)
          if (hasSuggestions) setOpen(true)
        }}
        onFocus={(e) => {
          if (hasSuggestions) setOpen(true)
          onFocus?.(e)
        }}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        role={hasSuggestions ? 'combobox' : undefined}
        aria-expanded={hasSuggestions ? showPopover : undefined}
        aria-autocomplete={hasSuggestions ? 'list' : undefined}
        {...rest}
      />
      <span className={styles.icon}>{icon ?? <MagnifierIcon />}</span>
      {showClear && (
        <button type="button" className={styles.clear} onClick={() => onValueChange('')} aria-label="Clear search">
          <ClearIcon />
        </button>
      )}
      {showPopover && (
        <div className={styles.popover} role="listbox">
          {suggestionsLoading ? (
            <div className={styles.hint}>Searching…</div>
          ) : suggestions!.length === 0 ? (
            <div className={styles.hint}>{emptyHint}</div>
          ) : (
            suggestions!.map((s, i) => (
              <button
                key={s.id}
                type="button"
                role="option"
                aria-selected={i === highlighted}
                className={classNames(styles.item, i === highlighted && styles.itemActive)}
                onMouseEnter={() => setHighlighted(i)}
                onClick={() => pick(s)}
              >
                {s.label}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
