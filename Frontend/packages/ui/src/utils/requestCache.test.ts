import { describe, expect, it, vi } from 'vitest'
import { createRequestCache } from './requestCache'

/**
 * The shared read cache every remote's HTTP layer goes through.
 *
 * Its whole value is in the edge cases: two callers during one request must share it (StrictMode's
 * double mount, a layout plus its page); a failure must not be remembered or the screen could never
 * recover; a mutation's invalidation must win even over a request that was already running, or a
 * save would be followed by the old list.
 */

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

describe('createRequestCache', () => {
  it('shares one request between callers asking for the same key at the same time', async () => {
    const cache = createRequestCache()
    const loader = vi.fn(() => Promise.resolve(['a']))

    const [first, second] = await Promise.all([cache.get('GET /products', loader), cache.get('GET /products', loader)])

    expect(loader).toHaveBeenCalledTimes(1)
    expect(first).toBe(second)
  })

  it('reuses a result until its time to live runs out, then fetches again', async () => {
    let clock = 0
    const cache = createRequestCache({ ttlMs: 1_000, now: () => clock })
    const loader = vi.fn(() => Promise.resolve(clock))

    await cache.get('k', loader)
    clock = 999
    await cache.get('k', loader)
    expect(loader).toHaveBeenCalledTimes(1)

    clock = 1_001
    await cache.get('k', loader)
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('lets one entry live longer than the default', async () => {
    let clock = 0
    const cache = createRequestCache({ ttlMs: 1_000, now: () => clock })
    const loader = vi.fn(() => Promise.resolve('reference data'))

    await cache.get('ref', loader, { ttlMs: 60_000 })
    clock = 30_000
    await cache.get('ref', loader, { ttlMs: 60_000 })

    expect(loader).toHaveBeenCalledTimes(1)
  })

  it('does not remember a failure, so the next caller retries', async () => {
    const cache = createRequestCache()
    const loader = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce('ok')

    const failure = await cache.get('k', loader).catch((error: Error) => error)
    expect(failure).toBeInstanceOf(Error)
    expect((failure as Error).message).toBe('offline')

    await expect(cache.get('k', loader)).resolves.toBe('ok')
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('shares an unsuccessful result with concurrent callers but does not keep it', async () => {
    const cache = createRequestCache()
    const loader = vi.fn().mockResolvedValueOnce({ status: 500 }).mockResolvedValueOnce({ status: 200 })
    const ok = (r: { status: number }) => r.status === 200

    const [a, b] = await Promise.all([cache.get('k', loader, { shouldCache: ok }), cache.get('k', loader, { shouldCache: ok })])
    expect(a).toEqual({ status: 500 })
    expect(b).toBe(a)

    await expect(cache.get('k', loader, { shouldCache: ok })).resolves.toEqual({ status: 200 })
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('force bypasses a cached result', async () => {
    const cache = createRequestCache()
    const loader = vi.fn().mockResolvedValueOnce(1).mockResolvedValueOnce(2)

    await cache.get('k', loader)

    await expect(cache.get('k', loader, { force: true })).resolves.toBe(2)
  })

  it('invalidates by prefix and leaves other resources cached', async () => {
    const cache = createRequestCache()
    const leads = vi.fn(() => Promise.resolve('leads'))
    const states = vi.fn(() => Promise.resolve('states'))
    await cache.get('GET /api/leads?page=1', leads)
    await cache.get('GET /api/leads?page=2', leads)
    await cache.get('GET /api/states', states)

    cache.invalidate('GET /api/leads')
    await cache.get('GET /api/leads?page=1', leads)
    await cache.get('GET /api/states', states)

    expect(leads).toHaveBeenCalledTimes(3)
    expect(states).toHaveBeenCalledTimes(1)
  })

  it('does not let a request that was running during an invalidation become the cached answer', async () => {
    const cache = createRequestCache()
    const stale = deferred<string>()
    const loader = vi.fn().mockReturnValueOnce(stale.promise).mockResolvedValueOnce('fresh')

    const before = cache.get('k', loader)
    cache.invalidate('k')
    stale.resolve('stale')
    await expect(before).resolves.toBe('stale')

    await expect(cache.get('k', loader)).resolves.toBe('fresh')
    expect(loader).toHaveBeenCalledTimes(2)
  })

  it('clear forgets everything', async () => {
    const cache = createRequestCache()
    const loader = vi.fn(() => Promise.resolve('x'))
    await cache.get('a', loader)
    await cache.get('b', loader)

    cache.clear()
    await cache.get('a', loader)

    expect(loader).toHaveBeenCalledTimes(3)
  })
})
