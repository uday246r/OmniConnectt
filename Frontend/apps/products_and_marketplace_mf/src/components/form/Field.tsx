import { useId, type ReactNode } from 'react';
import styles from './Field.module.css';

export interface FieldProps {
  label: string;
  required?: boolean;
  helper?: ReactNode;
  /** The message for this field, from the client's own check or the server's per-field answer. */
  error?: string;
  children: ReactNode;
}

/**
 * A label, a control, a hint and an error, tied together for assistive technology.
 *
 * The shared `Input` carries its own label; this is for everything that does not — selects, switches,
 * the icon picker. The group is named by the label, and an error is announced when it appears.
 */
export function Field({ label, required, helper, error, children }: FieldProps) {
  const labelId = useId();
  const messageId = useId();
  return (
    <div className={styles.field} role="group" aria-labelledby={labelId} aria-describedby={error || helper ? messageId : undefined}>
      <span id={labelId} className={styles.label}>
        {label}
        {required && <span className={styles.required} aria-hidden="true"> *</span>}
      </span>
      {children}
      {error ? (
        <span id={messageId} className={styles.error} role="alert">
          {error}
        </span>
      ) : helper ? (
        <span id={messageId} className={styles.helper}>
          {helper}
        </span>
      ) : null}
    </div>
  );
}
