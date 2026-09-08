import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { classNames } from '../../utils/classNames'
import { sanitizeFilterInput, filterInputMode, filterTypeBlockedMessage, type FilterInputType } from '../../utils/filterInput'
import { useSuggestions, type SuggestionSource } from '../../hooks/useSuggestions'
import styles from './ColumnFilter.module.css'

export interface ColumnFilterOption {
  /** The value written back through `onChange`. The empty string means "no filter". */
  value: string
  label: ReactNode
  /** Optional leading glyph or colour swatch. */
  icon?: ReactNode
}

export interface ColumnFilterProps {
  /** The column heading, e.g. "STATUS". Rendered uppercase by the stylesheet. */
  label: ReactNode
  /** Currently selected value; the empty string means unfiltered. */
  value: string
  onChange: (value: string) => void
  options: ColumnFilterOption[]
  /** Popover heading. Defaults to `Filter {label}`. */
  title?: ReactNode
  /** Label for the "no filter" row. Omit to hide that row. */
  allLabel?: ReactNode
  /** Show a type-to-search box above the list. Worth it past roughly ten options. */
  searchable?: boolean
  /**
   * The typed text IS the filter, rather than a way to narrow `options`.
   *
   * For columns with no fixed vocabulary — a customer name, an IC number, a phone. Submits on
   * Enter or on blur so a keystroke does not fire a request per character; the host's equivalent
   * columns filtered as-you-type against an already-loaded page, which is not what these do.
   */
  freeText?: boolean
  /**
   * Restricts what the free-text box accepts to match the column's own data type — 'numeric' for an
   * IC number, phone, or account number; 'alpha' for a person's name. Defaults to 'text' (no
   * restriction), same as before this existed. Ignored when `freeText` is not set.
   */
  filterType?: FilterInputType
  searchPlaceholder?: string
  /** Shown when a search matches nothing. */
  emptyHint?: ReactNode
  className?: string
  /**
   * Caller-computed matches shown under a `freeText` box as the operator types — a name, a phone
   * number, anything the caller can look up from data it already has (or fetch). `undefined` (the
   * default) means "no suggestions": the box behaves exactly as before, Enter-to-apply only.
   * Passing an array — even an empty one — opts into the suggestion list; an empty array then
   * renders as "no matches" rather than the plain "Press Enter to apply" hint.
   */
  suggestions?: ColumnFilterOption[]
  /** Fires on every (sanitized) keystroke in a `freeText` box, so the caller can recompute `suggestions`. Ignored outside `freeText`. */
  onSearchChange?: (value: string) => void
  /** Shows a "Searching…" row in place of the suggestion list while the caller's own lookup is in flight. */
  suggestionsLoading?: boolean
  /**
   * Candidate values taken from the rows this table has ALREADY loaded. The popover debounces the
   * typed text itself, matches these against it and lists the hits — the zero-boilerplate
   * alternative to computing `suggestions` by hand.
   *
   * Wiring a column the explicit way costs a raw state, a debounced derivation, a `useMemo` and two
   * props — roughly a dozen lines each, which is why nine of the platform's ten free-text columns
   * still showed nothing but "Press Enter to apply". This makes it one prop.
   *
   * Matching honours `filterType`, so a 'numeric' column compares digits only and typing `9898`
   * finds a stored `+91 9898 989 898`. Ignored unless `freeText`, and `suggestions` wins if both
   * are given.
   */
  suggestFrom?: (string | SuggestionSource)[]
}

const NO_POOL: (string | SuggestionSource)[] = []

/**
 * A table column header that filters its own column.
 *
 * Renders the `<th>` itself, so a caller writes `<ColumnFilter … />` where it would have written
 * `<th>STATUS</th>`.
 *
 * The host had this on its Approval Center and Audit Logs — two hand-maintained copies of ~15 CSS
 * rules and the same open/close, click-outside and Escape handling each time. Neither remote had it
 * at all: lead_mf's Lead Directory had a single global "Filter" button and customer360_mf's tables
 * had nothing, so filtering a column was something you could do in the host and not one click away
 * in a remote.
 *
 * Open/closed state is owned here rather than lifted to the table, because the only thing a table
 * ever did with it was "close the others" — which a single open popover per instance plus
 * click-outside already gives you.
 */
export function ColumnFilter({
  label,
  value,
  onChange,
  options,
  title,
  allLabel = 'All',
  searchable = true,
  freeText,
  filterType = 'text',
  searchPlaceholder = 'Type to search…',
  emptyHint,
  className,
  suggestions,
  onSearchChange,
  suggestionsLoading,
  suggestFrom,
}: ColumnFilterProps) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState('')
  // True right after a keystroke that sanitizeFilterInput actually had to strip something from —
  // cleared as soon as a keystroke doesn't, so the hint tracks "was that last character rejected"
  // rather than lingering once the operator has corrected course.
  const [blocked, setBlocked] = useState(false)
  // Which suggestion the keyboard has moved to; -1 means none, so Enter still falls through to
  // commitFreeText (the pre-existing behaviour) rather than picking something the operator never
  // highlighted.
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const rootRef = useRef<HTMLTableCellElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const popoverId = useId()

  /*
   * The popover is PORTALLED to <body> and positioned from the trigger's viewport rect.
   *
   * As a plain absolutely-positioned child of the <th> it was clipped by DataTable's own
   * `overflow-x: auto` scroll container — a scroll container establishes a clipping box, and no
   * amount of z-index escapes it. In the Lead Directory it rendered as a half-visible box sliced
   * off at the table edge.
   *
   * Portalling puts it outside every remote's `#…-mf-scope`, which is safe here specifically
   * because this is a CSS Module: modules are excluded from the scope prefixer and hash to unique
   * names, and the `--omni-*` tokens live on the real `:root`. A GLOBAL stylesheet would lose its
   * styling here; this does not.
   */
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const rect = rootRef.current?.getBoundingClientRect()
      if (!rect) return
      // Keep it on screen: 260px is the popover's min-width plus its border.
      const left = Math.min(rect.left, window.innerWidth - 268)
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

  // Close on outside click or Escape. Every host copy re-implemented the first half of this and
  // none of them handled Escape, so an open popover could only be dismissed by clicking away.
  useEffect(() => {
    if (!open) return
    function onPointerDown(e: MouseEvent) {
      const t = e.target as Node
      // The popover is portalled, so it is NOT inside rootRef any more — both must be checked, or
      // clicking anything in the popover would close it before the click landed.
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

  useEffect(() => {
    if (open) {
      // Free-text columns open showing what is currently filtering them, so the box can be edited
      // or emptied. Option lists open with an empty query.
      if (freeText) setSearch(value)
    } else {
      setSearch('')
    }
    setBlocked(false)
  }, [open, freeText, value])

  /** Sanitizes a keystroke against `filterType` (freeText or narrowing an options list alike) and
   *  flags `blocked` when the raw input actually had something stripped from it. */
  function handleSearchChange(raw: string) {
    setHighlightedIndex(-1)
    if (filterType === 'text') {
      setSearch(raw)
      setBlocked(false)
      if (freeText) onSearchChange?.(raw)
      return
    }
    const clean = sanitizeFilterInput(raw, filterType)
    setSearch(clean)
    setBlocked(clean !== raw)
    if (freeText) onSearchChange?.(clean)
  }

  /*
   * `suggestFrom` support. The hook runs unconditionally (rules of hooks) but is inert without a
   * pool: an empty array in, an empty array out, no debounce timer that matters.
   *
   * Only the SUPPLY of suggestions differs between the two paths — everything downstream (the
   * popover, Arrow/Enter/Escape, highlight, click-outside, commit-on-blur) is shared, so
   * `activeSuggestions` collapses them into one value the render already knows how to draw.
   */
  const { needle: suggestNeedle, items: derivedItems } = useSuggestions(
    suggestFrom ? search : '',
    suggestFrom ?? NO_POOL,
    // The value already filtering this column is dropped from its own suggestions: picking it would
    // change nothing, and it displaces an alternative that would.
    { numeric: filterType === 'numeric', exclude: value },
  )

  const derivedSuggestions = useMemo<ColumnFilterOption[] | undefined>(() => {
    if (!freeText || !suggestFrom) return undefined
    // Below the debounce, or before the operator has typed, hand back `[]` rather than `undefined`
    // so the popover shows its "start typing" affordance instead of falling back to the old
    // Enter-only hint and flickering between the two on every keystroke.
    if (!suggestNeedle) return []
    return derivedItems.map((s) => {
      const shown = s.label ?? s.value
      return {
        value: s.value,
        label: s.meta ? (
          <span className={styles.itemStack}>
            <span className={styles.itemLabel}>{shown}</span>
            <span className={styles.itemMeta}>{s.meta}</span>
          </span>
        ) : (
          shown
        ),
      }
    })
  }, [freeText, suggestFrom, suggestNeedle, derivedItems])

  const activeSuggestions = suggestions ?? derivedSuggestions

  const isFiltered = value !== ''
  const needle = search.trim().toLowerCase()
  const visible = freeText
    ? []
    : needle
      ? options.filter((o) => String(o.label ?? o.value).toLowerCase().includes(needle))
      : options

  function pick(next: string) {
    onChange(next)
    setOpen(false)
  }

  /**
   * Apply the typed text. Does NOT close — closing is the trigger's job, or the outside-click
   * handler's.
   *
   * It used to close, and that made a free-text column impossible to dismiss from its own header.
   * `mousedown` on the trigger blurs the input first, so the sequence ran: blur -> setOpen(false),
   * then the trigger's click -> setOpen(o => !o) with `o` already false -> true. The popover shut
   * and reopened in the same gesture, which is what "the arrow doesn't close it" was.
   */
  function commitFreeText() {
    const next = search.trim()
    if (next !== value) onChange(next)
  }

  return (
    <th ref={rootRef} className={classNames(styles.th, className)}>
      <button
        type="button"
        className={classNames(styles.trigger, isFiltered && styles.triggerActive)}
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-controls={open ? popoverId : undefined}
      >
        <span>{label}</span>
        <svg
          className={classNames(styles.icon, open && styles.iconOpen)}
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
        {isFiltered && <span className={styles.dot} aria-hidden="true" />}
      </button>

      {open && coords && createPortal(
        <div
          ref={popoverRef}
          className={styles.popover}
          id={popoverId}
          style={{ top: coords.top, left: coords.left }}
        >
          <div className={styles.header}>
            <span className={styles.title}>{title ?? <>Filter {label}</>}</span>
            {isFiltered && (
              <button type="button" className={styles.clearBtn} onClick={() => pick('')}>
                Reset
              </button>
            )}
          </div>

          {(searchable || freeText) && (
            <input
              type="text"
              inputMode={filterInputMode(filterType)}
              className={classNames(styles.input, blocked && styles.inputBlocked)}
              placeholder={searchPlaceholder}
              value={search}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={(e) => {
                if (freeText && activeSuggestions && activeSuggestions.length > 0 && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) {
                  e.preventDefault()
                  const delta = e.key === 'ArrowDown' ? 1 : -1
                  setHighlightedIndex((i) => (i + delta + activeSuggestions.length) % activeSuggestions.length)
                  return
                }
                if (e.key === 'Enter') {
                  e.preventDefault()
                  if (freeText) {
                    if (activeSuggestions && highlightedIndex >= 0 && highlightedIndex < activeSuggestions.length) {
                      pick(activeSuggestions[highlightedIndex].value)
                    } else {
                      commitFreeText()
                      setOpen(false)
                    }
                  } else if (visible.length > 0) {
                    pick(visible[0].value)
                  }
                }
              }}
              onBlur={freeText ? commitFreeText : undefined}
              autoFocus
            />
          )}

          {blocked && (
            <p className={styles.blockedHint} role="alert">
              {filterTypeBlockedMessage(filterType)}
            </p>
          )}

          {freeText ? (
            activeSuggestions !== undefined ? (
              <div className={styles.list}>
                {suggestionsLoading ? (
                  <div className={styles.emptyHint}>Searching…</div>
                ) : activeSuggestions.length === 0 ? (
                  <div className={styles.emptyHint}>
                    {search.trim() ? (emptyHint ?? `No matches for "${search}"`) : 'Start typing to see matches.'}
                  </div>
                ) : (
                  activeSuggestions.map((o, i) => (
                    <button
                      key={o.value}
                      type="button"
                      className={classNames(styles.item, i === highlightedIndex && styles.itemActive)}
                      onMouseEnter={() => setHighlightedIndex(i)}
                      onClick={() => pick(o.value)}
                    >
                      {o.icon}
                      <span className={styles.itemBody}>{o.label}</span>
                    </button>
                  ))
                )}
              </div>
            ) : (
              <p className={styles.emptyHint}>{emptyHint ?? 'Press Enter to apply.'}</p>
            )
          ) : (
          <div className={styles.list}>
            {allLabel !== undefined && !needle && (
              <button
                type="button"
                className={classNames(styles.item, !isFiltered && styles.itemActive)}
                onClick={() => pick('')}
              >
                <span>{allLabel}</span>
              </button>
            )}
            {visible.length === 0 ? (
              <div className={styles.emptyHint}>
                {emptyHint ?? `No matches for "${search}"`}
              </div>
            ) : (
              visible.map((o) => (
                <button
                  key={o.value}
                  type="button"
                  className={classNames(styles.item, value === o.value && styles.itemActive)}
                  onClick={() => pick(o.value)}
                >
                  {o.icon}
                  <span className={styles.itemBody}>{o.label}</span>
                </button>
              ))
            )}
          </div>
          )}
        </div>,
        document.body
      )}
    </th>
  )
}

export { styles as columnFilterStyles }
