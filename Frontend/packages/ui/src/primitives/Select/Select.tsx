import type { SelectHTMLAttributes } from 'react'
import { classNames } from '../../utils/classNames'
import styles from './Select.module.css'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

export interface SelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'size'> {
  options: SelectOption[]
  size?: 'sm' | 'md' | 'lg'
  /** Shown as a disabled first entry when the value is empty. */
  placeholder?: string
  className?: string
}

function ChevronIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

/**
 * The platform dropdown.
 *
 * Both remotes' Field Settings rendered a bare `<select>` for the masking rule, so it kept the
 * browser's own border, radius and arrow and read as an OS control dropped into the page — beside
 * inputs that were fully styled. The host had its own `.select` rule; this is that rule, shared.
 */
export function Select({ options, size = 'md', placeholder, className, value, ...rest }: SelectProps) {
  return (
    <span className={classNames(styles.wrap, className)}>
      <select className={classNames(styles.select, styles[size])} value={value} {...rest}>
        {placeholder !== undefined && (
          <option value="" disabled>
            {placeholder}
          </option>
        )}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <span className={styles.chevron}>
        <ChevronIcon />
      </span>
    </span>
  )
}
