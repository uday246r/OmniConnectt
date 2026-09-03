import { useId, type InputHTMLAttributes, type ReactNode } from 'react'
import { classNames } from '../../utils/classNames'
import styles from './Input.module.css'

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string
  helperText?: string
  errorText?: string
  leading?: ReactNode
  trailing?: ReactNode
}

export function Input({ label, helperText, errorText, leading, trailing, required, id, className, ...rest }: InputProps) {
  const generatedId = useId()
  const inputId = id ?? generatedId
  const hasError = Boolean(errorText)

  return (
    <div className={classNames(styles.field, hasError && styles.hasError, className)}>
      {label && (
        <label htmlFor={inputId} className={styles.label}>
          {label}
          {required && <span className={styles.required}>*</span>}
        </label>
      )}
      <div className={styles.inputWrapper}>
        {leading && <span className={styles.leading}>{leading}</span>}
        <input
          id={inputId}
          className={classNames(styles.input, Boolean(leading) && styles.inputWithLeading)}
          required={required}
          aria-invalid={hasError || undefined}
          aria-describedby={errorText ? `${inputId}-error` : helperText ? `${inputId}-helper` : undefined}
          {...rest}
        />
        {trailing && <span className={styles.trailing}>{trailing}</span>}
      </div>
      {errorText ? (
        <span id={`${inputId}-error`} className={styles.errorText} role="alert">
          {errorText}
        </span>
      ) : (
        helperText && (
          <span id={`${inputId}-helper`} className={styles.helperText}>
            {helperText}
          </span>
        )
      )}
    </div>
  )
}
