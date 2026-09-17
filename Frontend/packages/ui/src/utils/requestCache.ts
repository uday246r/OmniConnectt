/**
 * A small cache for read requests: one network call per resource, however many components ask.
 *
 * @remarks
 * The remotes fetch through hand-written stores, and nothing stopped the same GET going out several
 * times at once. React's StrictMode mounts every effect twice in development; a layout and the page
 * inside it both loaded the same data; a dependency changing mid-load fired the load again. Measured
 * in the browser, the Lead dashboard sent each of its five chart requests four times, and 22
 * simultaneous calls to one origin queued behind the browser's six-connection limit, so each extra
 * copy made every other request slower too.
 *
 * This fixes that at the one place every read passes through, instead of in each component:
 *
 * - **In-flight de-duplication.** Callers asking for the same key while a request is running share
 *   its promise. A double mount, or a layout and its page, costs one request.
 * - **Short-lived results.** A successful result is reused for `ttlMs` (default 30 s, the host's React
 *   Query `staleTime`), so moving between pages that show the same data does not refetch it.
 * - **Failures are never cached.** The next caller retries.
 * - **Explicit invalidation.** A mutation calls `invalidate(prefix)` for the resource it changed, so
 *   nobody reads a stale list after saving.
 *
 * It is deliberately not a data layer: no subscriptions, no background refetch, no React. Stores keep
 * owning their state; they just stop paying twice for it.
 */
export interface RequestCacheOptions {
  /** How long a successful result is reused, in milliseconds. Default 30 000. */
  ttlMs?: number
  /** Clock, injectable for tests. */
  now?: () => number
}

export interface RequestCacheGetOptions<T = unknown> {
  /** Overrides the cache-wide TTL for this entry (e.g. minutes for reference data). */
  ttlMs?: number
  /** Skip any cached result and in-flight request; the new result replaces both. */
  force?: boolean
  /**
   * Whether a resolved value may be reused. Defaults to always. A loader that resolves with an error
   * response rather than throwing (a fetch returning 500) passes this so that result is not remembered.
   */
  shouldCache?: (value: T) => boolean
}

export interface RequestCache {
  get<T>(key: string, loader: () => Promise<T>, options?: RequestCacheGetOptions<T>): Promise<T>
  /** Forget cached results and in-flight requests whose key starts with `prefix` (all of them when omitted). */
  invalidate(prefix?: string): void
  /** Forget everything — for sign-out, so the next user never sees the previous user's data. */
  clear(): void
}

interface Entry {
  promise: Promise<unknown>
  /** Absent while the request is still running. */
  expiresAt?: number
  /** Identifies this attempt, so a superseded request cannot write over its replacement. */
  generation: number
}

const DEFAULT_TTL_MS = 30_000

export function createRequestCache({ ttlMs = DEFAULT_TTL_MS, now = Date.now }: RequestCacheOptions = {}): RequestCache {
  const entries = new Map<string, Entry>()
  let generation = 0

  function get<T>(key: string, loader: () => Promise<T>, options: RequestCacheGetOptions<T> = {}): Promise<T> {
    const existing = entries.get(key)
    if (existing && !options.force) {
      const running = existing.expiresAt === undefined
      if (running || existing.expiresAt! > now()) return existing.promise as Promise<T>
    }

    const attempt = ++generation
    const lifetime = options.ttlMs ?? ttlMs
    const promise = loader().then(
      (value) => {
        const current = entries.get(key)
        // Only the attempt still registered for this key may mark itself reusable; one that was
        // invalidated or forced past while running just hands its value to the callers it already has.
        if (current?.generation === attempt) {
          if (options.shouldCache && !options.shouldCache(value)) entries.delete(key)
          else current.expiresAt = now() + lifetime
        }
        return value
      },
      (error: unknown) => {
        if (entries.get(key)?.generation === attempt) entries.delete(key)
        throw error
      },
    )

    entries.set(key, { promise, generation: attempt })
    return promise
  }

  function invalidate(prefix?: string) {
    if (prefix === undefined) {
      entries.clear()
      return
    }
    for (const key of [...entries.keys()]) {
      if (key.startsWith(prefix)) entries.delete(key)
    }
  }

  return { get, invalidate, clear: () => entries.clear() }
}
