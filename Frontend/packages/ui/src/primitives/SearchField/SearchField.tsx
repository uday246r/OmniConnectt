import type { InputHTMLAttributes, ReactNode } from 'react'
import { classNames } from '../../utils/classNames'
import styles from './SearchField.module.css'

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
  ...rest
}: SearchFieldProps) {
  const showClear = clearable && value.length > 0

  return (
    <div className={classNames(styles.wrap, className)}>
      <input
        type="text"
        className={classNames(styles.input, styles[size], showClear && styles.clearable)}
        value={value}
        onChange={(e) => onValueChange(e.target.value)}
        placeholder={placeholder}
        {...rest}
      />
      <span className={styles.icon}>{icon ?? <MagnifierIcon />}</span>
      {showClear && (
        <button type="button" className={styles.clear} onClick={() => onValueChange('')} aria-label="Clear search">
          <ClearIcon />
        </button>
      )}
    </div>
  )
}
