import { Combobox } from '../Combobox/Combobox'

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

/** The part of a change event Select's callers read. Kept so every existing `e.target.value` handler works unchanged. */
export interface SelectChangeEvent {
  target: { value: string }
  currentTarget: { value: string }
}

export interface SelectProps {
  options: SelectOption[]
  value?: string | number | null
  onChange?: (event: SelectChangeEvent) => void
  onBlur?: () => void
  size?: 'sm' | 'md' | 'lg'
  /** Shown when nothing is selected. */
  placeholder?: string
  disabled?: boolean
  id?: string
  className?: string
  'aria-label'?: string
  'aria-labelledby'?: string
  /** Offer a clearing row with this label, e.g. "All statuses". */
  clearLabel?: string
}

/**
 * The platform dropdown, for a fixed list of choices.
 *
 * It was a styled native `<select>`, which can only be searched by typing the first letter. It now
 * renders the shared searchable {@link Combobox}, so every Select across the host and the remotes can
 * be searched by any part of an option's name — with the same props it always took, including an
 * `onChange` that hands over `e.target.value`, so no caller had to change.
 */
export function Select({ options, value, onChange, onBlur, size = 'md', placeholder, disabled, id, className, clearLabel, ...aria }: SelectProps) {
  const current = value === null || value === undefined ? '' : String(value)
  return (
    <Combobox
      id={id}
      className={className}
      size={size}
      options={options}
      value={current}
      placeholder={placeholder}
      disabled={disabled}
      clearLabel={clearLabel}
      aria-label={aria['aria-label']}
      aria-labelledby={aria['aria-labelledby']}
      onBlur={onBlur}
      onChange={(next) => onChange?.({ target: { value: next }, currentTarget: { value: next } })}
    />
  )
}
