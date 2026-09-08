import { useEffect, useState } from 'react'

/**
 * Returns `value` after it has stopped changing for `delayMs`.
 *
 * Used for search inputs. A filter box that feeds straight into its fetch dependency fires one
 * request per keystroke — typing "administrator" fires thirteen uncancelled requests — and because
 * nothing cancels or sequence-checks them, a slow early response can overwrite a fast later one and
 * leave the table showing results for "admin" while the box reads "administrator".
 *
 * The input itself stays controlled by the raw value, so typing never feels laggy — only the query
 * waits. 200ms is this platform's convention for filtering an already-loaded in-memory pool
 * (Audit Logs, Approval Center, Users); 300ms (the default) suits a debounce feeding a real
 * server request or a heavier recompute.
 */
export function useDebouncedValue<T>(value: T, delayMs = 300): T {
  const [debounced, setDebounced] = useState(value)

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(value), delayMs)
    return () => window.clearTimeout(timer)
  }, [value, delayMs])

  return debounced
}
