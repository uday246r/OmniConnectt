import { useCallback, useState } from 'react';
import { fieldErrorsOf, isApprovalPending } from '../services/httpClient';

export interface SaveActionState {
  saving: boolean;
  /** Why the last save was refused, in words a person can act on. */
  error: string | null;
  /** The server's message for each field it refused, by field key. */
  fieldErrors: Record<string, string>;
  /**
   * Runs a save. Resolves true when it was applied, false when it was refused — or when it was sent for
   * approval instead, which is neither: the caller must not say "saved" about a change that has not taken
   * effect, and the toast has already told the person who has to approve it.
   */
  run: <T>(action: () => Promise<T>, options?: { onSaved?: (result: T) => void; onPending?: () => void }) => Promise<boolean>;
  reset: () => void;
}

/**
 * Busy, error and per-field-error state for one save, the same way in every form.
 *
 * Every drawer used to write its own try/catch, and each handled the three outcomes — applied, refused,
 * held for approval — slightly differently. A refusal keeps the form open with the reason; a change held
 * for approval closes it (`onPending`); only a real save reports success.
 */
export function useSaveAction(): SaveActionState {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  const reset = useCallback(() => {
    setError(null);
    setFieldErrors({});
  }, []);

  const run = useCallback<SaveActionState['run']>(async (action, options) => {
    setSaving(true);
    setError(null);
    setFieldErrors({});
    try {
      const result = await action();
      options?.onSaved?.(result);
      return true;
    } catch (err) {
      if (isApprovalPending(err)) {
        options?.onPending?.();
        return false;
      }
      setError((err as Error).message);
      setFieldErrors(fieldErrorsOf(err) ?? {});
      return false;
    } finally {
      setSaving(false);
    }
  }, []);

  return { saving, error, fieldErrors, run, reset };
}
