import { forwardRef, useId, type TextareaHTMLAttributes } from 'react'
import { classNames } from '../../utils/classNames'
import styles from './TextArea.module.css'

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  /** Omit inside a {@link FormField}, which supplies the label and the wiring itself. */
  label?: string
  helperText?: string
  errorText?: string
}

/**
 * The multi-line field. {@link Input} has no multi-line form, so both remotes hand-rolled one.
 *
 * It takes a label for the same reason `Input` does — so a lone textarea needs nothing around it —
 * but leaves it out inside a `FormField`, which already renders the label and passes down the id.
 */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { label, helperText, errorText, required, rows = 3, id, className, ...rest },
  ref,
) {
  const generatedId = useId()
  const fieldId = id ?? generatedId
  const messageId = `${fieldId}-message`
  const hasError = Boolean(errorText)

  return (
    <div className={classNames(styles.field, className)}>
      {label && (
        <label htmlFor={fieldId} className={styles.label}>
          {label}
          {required && (
            <span className={styles.required} aria-hidden="true">
              {' '}
              *
            </span>
          )}
        </label>
      )}
      <textarea
        {...rest}
        ref={ref}
        id={fieldId}
        rows={rows}
        required={required}
        aria-invalid={hasError || rest['aria-invalid'] || undefined}
        aria-describedby={errorText || helperText ? messageId : rest['aria-describedby']}
        className={classNames(styles.control, hasError && styles.invalid)}
      />
      {(errorText || helperText) && (
        <span
          id={messageId}
          className={hasError ? styles.error : styles.helper}
          role={hasError ? 'alert' : undefined}
        >
          {errorText ?? helperText}
        </span>
      )}
    </div>
  )
})
