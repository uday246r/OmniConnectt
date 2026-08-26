import { useEffect, useId, useRef, useState } from 'react'
import { Icon } from '../Icon/Icon'
import { useClickOutside } from '../../hooks/useClickOutside'
import { useDebouncedValue } from '../../hooks/useDebouncedValue'
import styles from './AsyncSearchSelect.module.css'

export interface AsyncSearchOption {
  id: string
  label: string
  /** Secondary line — an email, a description. Also matched by the server-side search. */
  sublabel?: string
  /** Rendered in the avatar circle; falls back to initials derived from the label. */
  initials?: string
}

export interface AsyncSearchResult {
  options: AsyncSearchOption[]
  /**
   * Total matches on the SERVER, which may exceed `options.length`. Supplying it lets the menu say
   * "showing 25 of 1,240" so the operator knows the list is a window onto more, not the whole set.
   */
  total?: number
}

export interface AsyncSearchSelectProps {
  value: string | null
  /**
   * Receives the chosen option as well as its id. The caller needs the whole option to keep rendering
   * the selection once it drops out of the current result window — see `selected` below.
   */
  onChange: (id: string | null, option: AsyncSearchOption | null) => void
  /**
   * Queries the SERVER for matches. Called on open with an empty term, then on every debounced
   * keystroke. Must not filter a pre-fetched array — the whole point is that the caller cannot hold
   * every record in memory.
   */
  onSearch: (term: string) => Promise<AsyncSearchResult>
  /**
   * The currently selected option, owned by the caller.
   *
   * Required for correctness, not convenience: the selected record frequently is not in the current
   * result window (you searched "smith", the saved value is "Adams"). Without it the control would
   * render an empty trigger and look like it had lost the value.
   */
  selected?: AsyncSearchOption | null
  placeholder?: string
  searchPlaceholder?: string
  emptyMessage?: string
  disabled?: boolean
  showAvatar?: boolean
  /** Marks the field as required for assistive tech; purely presentational otherwise. */
  required?: boolean
  id?: string
}

function deriveInitials(label: string): string {
  const parts = label.trim().split(/\s+/)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return label.slice(0, 2).toUpperCase()
}

/**
 * A select whose options come from the server, one search at a time.
 *
 * <p>Replaces the pattern this codebase used everywhere: fetch a page of records, then filter that
 * page in a `useMemo`. Since the list endpoints clamp `pageSize` to 100, that made every record past
 * the hundredth unreachable — the search box appeared to work while silently searching a fraction of
 * the data. Here the typing goes to the server, so the reachable set is the whole table.</p>
 *
 * <p>Two details that are easy to get wrong and are handled here: a stale response from a slower
 * earlier keystroke can never overwrite a newer one (see the sequence guard), and the selected option
 * is always rendered even when it falls outside the current results.</p>
 */
export function AsyncSearchSelect({
  value,
  onChange,
  onSearch,
  selected,
  placeholder = '-- Select --',
  searchPlaceholder = 'Type to search…',
  emptyMessage = 'No matches found',
  disabled = false,
  showAvatar = false,
  required = false,
  id,
}: AsyncSearchSelectProps) {
  const [open, setOpen] = useState(false)
  const [term, setTerm] = useState('')
  const [options, setOptions] = useState<AsyncSearchOption[]>([])
  const [total, setTotal] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeIndex, setActiveIndex] = useState(-1)

  const wrapRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const generatedId = useId()
  const controlId = id ?? generatedId

  useClickOutside([wrapRef], () => setOpen(false), open)

  const debouncedTerm = useDebouncedValue(term, 250)

  // Monotonic request id. Responses that are not the newest are discarded — without this, a slow
  // response for "a" can land after a fast one for "abc" and repopulate the list with the wrong set.
  const requestSeq = useRef(0)

  // Kept in a ref so a caller passing an inline arrow function does not restart the search on every
  // parent render.
  const onSearchRef = useRef(onSearch)
  onSearchRef.current = onSearch

  useEffect(() => {
    if (!open) return
    let cancelled = false
    const seq = ++requestSeq.current

    setLoading(true)
    setError(null)

    void (async () => {
      try {
        const result = await onSearchRef.current(debouncedTerm)
        if (cancelled || seq !== requestSeq.current) return
        setOptions(result.options)
        setTotal(result.total)
        setActiveIndex(result.options.length > 0 ? 0 : -1)
      } catch {
        if (cancelled || seq !== requestSeq.current) return
        setOptions([])
        setTotal(undefined)
        setError('Could not load matches. Try again.')
      } finally {
        if (!cancelled && seq === requestSeq.current) setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [open, debouncedTerm])

  function choose(option: AsyncSearchOption) {
    onChange(option.id, option)
    setOpen(false)
    setTerm('')
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (!open) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIndex((i) => {
        const next = e.key === 'ArrowDown' ? i + 1 : i - 1
        if (next < 0) return options.length - 1
        if (next >= options.length) return 0
        return next
      })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const option = options[activeIndex]
      if (option) choose(option)
    } else if (e.key === 'Escape') {
      e.preventDefault()
      setOpen(false)
    }
  }

  // Keep the highlighted row in view during keyboard navigation.
  useEffect(() => {
    if (!open || activeIndex < 0) return
    const node = listRef.current?.children[activeIndex] as HTMLElement | undefined
    node?.scrollIntoView({ block: 'nearest' })
  }, [activeIndex, open])

  const truncated = total !== undefined && total > options.length

  return (
    <div className={styles.wrap} ref={wrapRef}>
      <button
        type="button"
        id={controlId}
        className={`${styles.trigger} ${open ? styles.triggerOpen : ''}`}
        onClick={() => {
          if (disabled) return
          setOpen((v) => !v)
          if (!open) setTerm('')
        }}
        onKeyDown={handleKeyDown}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-required={required}
        disabled={disabled}
      >
        <span className={styles.triggerLeft}>
          {selected ? (
            <>
              {showAvatar && (
                <span className={styles.avatar}>{selected.initials ?? deriveInitials(selected.label)}</span>
              )}
              <span className={styles.triggerLabel}>{selected.label}</span>
              {selected.sublabel && <span className={styles.triggerSub}>({selected.sublabel})</span>}
            </>
          ) : (
            <span className={styles.placeholder}>{placeholder}</span>
          )}
        </span>
        <Icon.ChevronDown
          width={13}
          height={13}
          className={`${styles.chevron} ${open ? styles.chevronOpen : ''}`}
        />
      </button>

      {open && (
        <div className={styles.menu} role="listbox" aria-labelledby={controlId}>
          <div className={styles.searchWrap}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder={searchPlaceholder}
              value={term}
              onChange={(e) => setTerm(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
            />
            <Icon.Search width={12} height={12} className={styles.searchIcon} />
          </div>

          <div className={styles.list} ref={listRef}>
            {loading ? (
              <div className={styles.status}>Searching…</div>
            ) : error ? (
              <div className={styles.status}>{error}</div>
            ) : options.length === 0 ? (
              <div className={styles.status}>
                {term ? `${emptyMessage} for “${term}”` : emptyMessage}
              </div>
            ) : (
              options.map((option, index) => {
                const isSelected = value === option.id
                return (
                  <div
                    key={option.id}
                    className={[
                      styles.item,
                      isSelected ? styles.itemSelected : '',
                      index === activeIndex ? styles.itemActive : '',
                    ].filter(Boolean).join(' ')}
                    role="option"
                    aria-selected={isSelected}
                    onMouseEnter={() => setActiveIndex(index)}
                    onClick={() => choose(option)}
                  >
                    <span className={styles.itemLeft}>
                      {showAvatar && (
                        <span className={styles.avatarSmall}>
                          {option.initials ?? deriveInitials(option.label)}
                        </span>
                      )}
                      <span className={styles.itemText}>
                        <span className={styles.itemLabel}>{option.label}</span>
                        {option.sublabel && <span className={styles.itemSub}>{option.sublabel}</span>}
                      </span>
                    </span>
                    {isSelected && <Icon.Check width={13} height={13} className={styles.itemCheck} />}
                  </div>
                )
              })
            )}
          </div>

          {/*
            Says plainly that the list is a window, not the whole set. Without this an operator who
            knows there are 1,200 users sees 25 and reasonably concludes the control is broken — the
            complaint that prompted this component in the first place.
          */}
          {truncated && !loading && (
            <div className={styles.footer}>
              Showing {options.length} of {total?.toLocaleString()} — keep typing to narrow
            </div>
          )}
        </div>
      )}
    </div>
  )
}
