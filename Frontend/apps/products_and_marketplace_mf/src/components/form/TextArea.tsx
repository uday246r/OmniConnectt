import { forwardRef, useId, type TextareaHTMLAttributes } from 'react';
import styles from './TextArea.module.css';

export interface TextAreaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label: string;
  helperText?: string;
  errorText?: string;
}

/** A labelled multi-line field, matching the shared `Input` (which has no multi-line form). */
export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea({ label, helperText, errorText, required, rows = 3, ...rest }, ref) {
  const id = useId();
  const messageId = `${id}-message`;
  return (
    <div className={styles.field}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {required && <span className={styles.required} aria-hidden="true"> *</span>}
      </label>
      <textarea
        {...rest}
        ref={ref}
        id={id}
        rows={rows}
        required={required}
        aria-invalid={errorText ? true : undefined}
        aria-describedby={errorText || helperText ? messageId : undefined}
        className={`${styles.control} ${errorText ? styles.invalid : ''}`}
      />
      {(errorText || helperText) && (
        <span id={messageId} className={errorText ? styles.error : styles.helper} role={errorText ? 'alert' : undefined}>
          {errorText ?? helperText}
        </span>
      )}
    </div>
  );
});
