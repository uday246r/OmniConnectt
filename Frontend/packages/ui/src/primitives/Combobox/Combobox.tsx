import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { classNames } from '../../utils/classNames'
import styles from './Combobox.module.css'

export interface ComboboxOption {
  value: string
  label: string
  /** A second, quieter line — also searched. */
  description?: string
  /** Options sharing a group are listed under its heading, in the order groups first appear. */
  group?: string
  /** Shown before the label, e.g. a flag. Decorative; not searched. */
  prefix?: ReactNode
  disabled?: boolean
  /** Extra words that should find this option without being shown, e.g. a dial code's country name. */
  keywords?: string
}

export interface ComboboxProps {
  options: ComboboxOption[]
  /** The selected value; the empty string means nothing is selected. */
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  placeholder?: string
  /** Offer a row that clears the selection, labelled with this text (e.g. "All products"). */
  clearLabel?: string
  emptyMessage?: string
  disabled?: boolean
  invalid?: boolean
  size?: 'sm' | 'md' | 'lg'
  id?: string
  /** Accessible name when there is no associated `<label htmlFor>`. */
  'aria-label'?: string
  'aria-labelledby'?: string
  'aria-describedby'?: string
  /** Called with the typed text, for options fetched from a server. The caller replaces `options`. */
  onSearch?: (query: string) => void
  loading?: boolean
  className?: string
}

// Accents do not stop a match: typing "sao paulo" finds "São Paulo".
const normalize = (text: string) => text.normalize('NFKD').replace(/\p{Diacritic}/gu, '').toLowerCase()

/**
 * The platform dropdown: type to search, always.
 *
 * Replaces the mix it grew into — native `<select>`s that could only be searched by the first letter,
 * a lead-management dropdown that searched, a products dropdown that did not, and filters that
 * offered a search box only past six options. People pick branches, products, countries and formats
 * from long lists; typing any part of the name must find it.
 *
 * Follows the WAI-ARIA combobox pattern: the input carries `role="combobox"`, the list is a
 * `listbox` of `option`s, the highlighted option is announced through `aria-activedescendant`, and
 * ArrowUp/ArrowDown/Home/End/Enter/Escape/Tab behave as a screen-reader user expects. The list is
 * portalled to `document.body` so a table's or drawer's overflow never clips it.
 */
export function Combobox({
  options,
  value,
  onChange,
  onBlur,
  placeholder = 'Select…',
  clearLabel,
  emptyMessage = 'No matches',
  disabled = false,
  invalid = false,
  size = 'md',
  id,
  onSearch,
  loading = false,
  className,
  ...aria
}: ComboboxProps) {
  const generatedId = useId()
  const inputId = id ?? `combobox-${generatedId}`
  const listId = `${inputId}-listbox`

  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)

  const selected = options.find((o) => o.value === value)

  const rows = useMemo(() => {
    const needle = normalize(query.trim())
    // A server search already filtered; filtering again would hide matches on words it indexed.
    const matches = onSearch || !needle
      ? options
      : options.filter((o) => normalize(`${o.label} ${o.description ?? ''} ${o.keywords ?? ''}`).includes(needle))
    const cleared: ComboboxOption[] = clearLabel && !needle ? [{ value: '', label: clearLabel }] : []
    return [...cleared, ...matches]
  }, [options, query, clearLabel, onSearch])

  const selectable = rows.filter((o) => !o.disabled)

  function openList() {
    if (disabled) return
    setOpen(true)
    setQuery('')
    const index = rows.findIndex((o) => o.value === value)
    setActive(Math.max(0, index))
  }

  function close(commit?: ComboboxOption) {
    setOpen(false)
    setQuery('')
    if (commit && !commit.disabled && commit.value !== value) onChange(commit.value)
  }

  useLayoutEffect(() => {
    if (!open) return
    const update = () => {
      const r = wrapRef.current?.getBoundingClientRect()
      if (r) setRect({ top: r.bottom + 4, left: r.left, width: r.width })
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
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as Node
      if (!wrapRef.current?.contains(target) && !listRef.current?.contains(target)) {
        close()
        onBlur?.()
      }
    }
    document.addEventListener('mousedown', onPointerDown)
    return () => document.removeEventListener('mousedown', onPointerDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  useEffect(() => {
    if (active >= rows.length) setActive(Math.max(0, rows.length - 1))
  }, [rows.length, active])

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [active, open])

  function move(step: number) {
    if (selectable.length === 0) return
    let next = active
    for (let i = 0; i < rows.length; i++) {
      next = (next + step + rows.length) % rows.length
      if (!rows[next].disabled) break
    }
    setActive(next)
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault()
        if (!open) openList()
        else move(1)
        break
      case 'ArrowUp':
        event.preventDefault()
        if (!open) openList()
        else move(-1)
        break
      case 'Home':
        if (open) {
          event.preventDefault()
          setActive(rows.findIndex((o) => !o.disabled))
        }
        break
      case 'End':
        if (open) {
          event.preventDefault()
          setActive(rows.length - 1 - [...rows].reverse().findIndex((o) => !o.disabled))
        }
        break
      case 'Enter':
        if (open) {
          event.preventDefault()
          close(rows[active])
        } else {
          openList()
        }
        break
      case 'Escape':
        if (open) {
          event.preventDefault()
          event.stopPropagation()
          close()
        }
        break
      case 'Tab':
        if (open) close()
        break
    }
  }

  const activeOption = open ? rows[active] : undefined
  let lastGroup: string | undefined

  return (
    <div ref={wrapRef} className={classNames(styles.wrap, styles[size], invalid && styles.invalid, disabled && styles.disabled, className)}>
      {!open && selected?.prefix && <span className={styles.prefix} aria-hidden="true">{selected.prefix}</span>}
      <input
        ref={inputRef}
        id={inputId}
        type="text"
        role="combobox"
        className={styles.input}
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeOption ? `${listId}-${active}` : undefined}
        aria-invalid={invalid || undefined}
        aria-label={aria['aria-label']}
        aria-labelledby={aria['aria-labelledby']}
        aria-describedby={aria['aria-describedby']}
        disabled={disabled}
        autoComplete="off"
        spellCheck={false}
        // Closed, the input shows the selection, so it is also what assistive technology reads.
        value={open ? query : (selected?.label ?? '')}
        placeholder={open ? (selected?.label ?? 'Type to search…') : placeholder}
        title={selected?.label}
        onChange={(e) => {
          if (!open) setOpen(true)
          setQuery(e.target.value)
          setActive(0)
          onSearch?.(e.target.value)
        }}
        onMouseDown={() => (open ? undefined : openList())}
        onKeyDown={onKeyDown}
        onBlur={(e) => {
          // Moving focus into the list (a click) is not leaving the control.
          if (listRef.current?.contains(e.relatedTarget as Node)) return
          if (!open) onBlur?.()
        }}
      />
      <span className={styles.chevron} aria-hidden="true">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <polyline points={open ? '18 15 12 9 6 15' : '6 9 12 15 18 9'} />
        </svg>
      </span>

      {open && rect && createPortal(
        <ul
          ref={listRef}
          id={listId}
          role="listbox"
          aria-label={aria['aria-label']}
          className={styles.list}
          style={{ top: rect.top, left: rect.left, minWidth: rect.width }}
        >
          {loading && <li className={styles.status} role="presentation">Searching…</li>}
          {!loading && rows.length === 0 && <li className={styles.status} role="presentation">{emptyMessage}</li>}
          {!loading && rows.map((option, index) => {
            const heading = option.group && option.group !== lastGroup ? option.group : undefined
            lastGroup = option.group ?? lastGroup
            return [
              heading && (
                <li key={`group-${heading}`} className={styles.group} role="presentation">{heading}</li>
              ),
              <li
                key={`${option.value}-${index}`}
                id={`${listId}-${index}`}
                data-index={index}
                role="option"
                aria-selected={option.value === value}
                aria-disabled={option.disabled || undefined}
                className={classNames(
                  styles.option,
                  index === active && styles.active,
                  option.value === value && styles.selected,
                  option.disabled && styles.optionDisabled,
                  option.value === '' && clearLabel && styles.clear,
                )}
                onMouseDown={(e) => e.preventDefault()}
                onMouseEnter={() => !option.disabled && setActive(index)}
                onClick={() => {
                  close(option)
                  inputRef.current?.focus()
                }}
              >
                {option.prefix && <span className={styles.prefix}>{option.prefix}</span>}
                <span className={styles.optionText}>
                  <span className={styles.optionLabel}>{option.label}</span>
                  {option.description && <span className={styles.optionDescription}>{option.description}</span>}
                </span>
              </li>,
            ]
          })}
        </ul>,
        document.body,
      )}
    </div>
  )
}
