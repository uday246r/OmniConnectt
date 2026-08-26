import { useEffect, type DependencyList } from 'react'
import { isAbortError } from '../api/httpClient'

/**
 * `useEffect` for data fetching, where cleanup actually cancels the request.
 *
 * <p>The pattern this replaces was correct but incomplete:</p>
 *
 * <pre>
 *   let cancelled = false
 *   load().then(r => { if (cancelled) return; setState(r) })
 *   return () => { cancelled = true }
 * </pre>
 *
 * <p>That flag reliably stops a stale response from being written to state — so it was never the
 * source of a race — but it does not stop the request. The browser still downloads a response nobody
 * will read, the server still does the work, and the connection stays occupied. In React's
 * StrictMode, which deliberately mounts, cleans up and remounts every effect once in development,
 * that is precisely why every endpoint appears twice in the Network tab with both calls completing.
 * StrictMode is worth keeping — it surfaces real cleanup bugs — but the wasted request is not.</p>
 *
 * <p>Aborts are swallowed rather than reported. A cancelled request is the caller getting exactly
 * what it asked for; surfacing it as an error would put "could not load" on screen every time
 * somebody navigated away mid-flight.</p>
 *
 * @param effect receives an AbortSignal to pass into `apiFetch`. Any other rejection is re-thrown to
 *   the caller's own handling, so genuine failures still reach the UI.
 */
export function useAbortableEffect(
  effect: (signal: AbortSignal) => void | Promise<void>,
  deps: DependencyList,
): void {
  useEffect(() => {
    const controller = new AbortController()

    void (async () => {
      try {
        await effect(controller.signal)
      } catch (err) {
        if (isAbortError(err)) return
        throw err
      }
    })()

    return () => controller.abort()
    // The effect callback is intentionally excluded: callers pass an inline arrow, which would be a
    // new identity every render and re-fire the request forever. The dependency list they supply is
    // the real contract, exactly as with useEffect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
}
