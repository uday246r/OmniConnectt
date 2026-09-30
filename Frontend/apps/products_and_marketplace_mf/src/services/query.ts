/**
 * Query parameters without the empty ones.
 *
 * A filter that is not set should be absent from the URL, not sent as `search=`. It keeps requests
 * readable, and — because reads are cached by URL — it means "no filter" is one cache entry however it
 * was reached.
 */
export function cleanParams<T extends object>(params: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(params).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  ) as Partial<T>;
}
