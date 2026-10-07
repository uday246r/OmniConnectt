import { useId, type ReactNode } from 'react'
import { classNames } from '../../utils/classNames'
import styles from './FormField.module.css'

/** What a control needs so the label names it and its message is announced. */
export interface FormFieldControl {
  /** Put this on the control; the field's `<label htmlFor>` points at it. */
  id: string
  /** True while the field has an error — for `invalid` on {@link Combobox} and {@link Select}. */
  invalid: boolean
  /** The id of the error or helper line, for `aria-describedby`. */
  describedBy: string | undefined
  /** Whether the field is required, to forward to a native control. */
  required: boolean | undefined
  /**
   * The whole set, ready to spread onto a native `input`, `select` or `textarea`:
   * `<input {...control.aria} />`.
   */
  aria: {
    id: string
    required: boolean | undefined
    'aria-invalid': true | undefined
    'aria-describedby': string | undefined
  }
}

export interface FormFieldProps {
  label: string
  required?: boolean
  /** This field's message — from the client's own check or the server's per-field answer. */
  error?: string
  /** A hint shown while there is no error. Replaced by the error, never stacked under it. */
  helper?: ReactNode
  /** Span every column of the surrounding {@link FormGrid}. */
  full?: boolean
  className?: string
  /**
   * The control. Given a function, the field renders a real `<label htmlFor>` and hands over the
   * wiring — the accessible form, and what nearly every field should use.
   *
   * Given a plain node it cannot reach inside to set an id, so it falls back to naming a `group` by
   * its label. That is for controls that carry their own labelling (a switch row, an icon picker) or
   * for several controls under one name (a phone prefix beside a number).
   */
  children: ReactNode | ((control: FormFieldControl) => ReactNode)
}

/**
 * A label, a control, a hint and an error, tied together for assistive technology.
 *
 * The package shipped `Input`, which carries its own label, and nothing for the controls that do not
 * — selects, comboboxes, textareas, date pickers. So three competing field systems grew up instead:
 * the host's own form layer, lead management's global `.form-*` classes, and the marketplace's local
 * `Field`. This is the one the others collapse into.
 *
 * It is not only a wrapper for the look. The lead forms had no `htmlFor`, no `id`, no `aria-invalid`
 * and no `aria-describedby` anywhere, so a screen reader announced an unnamed box and never read the
 * message that appeared beneath it. Passing a function gets all four right without the caller
 * thinking about it.
 */
export function FormField({ label, required, error, helper, full, className, children }: FormFieldProps) {
  const base = useId()
  const controlId = `${base}-control`
  const labelId = `${base}-label`
  const messageId = `${base}-message`
  const describedBy = error || helper ? messageId : undefined

  const control: FormFieldControl = {
    id: controlId,
    invalid: Boolean(error),
    describedBy,
    required,
    aria: {
      id: controlId,
      required,
      'aria-invalid': error ? true : undefined,
      'aria-describedby': describedBy,
    },
  }

  const wired = typeof children === 'function'

  const message = error ? (
    <span id={messageId} className={styles.error} role="alert">
      {error}
    </span>
  ) : helper ? (
    <span id={messageId} className={styles.helper}>
      {helper}
    </span>
  ) : null

  const name = (
    <>
      {label}
      {required && (
        <span className={styles.required} aria-hidden="true">
          {' '}
          *
        </span>
      )}
    </>
  )

  return (
    <div
      className={classNames(styles.field, full && styles.full, className)}
      // Only when the control could not be given an id: a group named by its label is the next best
      // thing, and is how the marketplace's local Field already behaved.
      role={wired ? undefined : 'group'}
      aria-labelledby={wired ? undefined : labelId}
      aria-describedby={wired ? undefined : describedBy}
    >
      {wired ? (
        <label htmlFor={controlId} className={styles.label}>
          {name}
        </label>
      ) : (
        <span id={labelId} className={styles.label}>
          {name}
        </span>
      )}
      {wired ? (children as (c: FormFieldControl) => ReactNode)(control) : children}
      {message}
    </div>
  )
}
