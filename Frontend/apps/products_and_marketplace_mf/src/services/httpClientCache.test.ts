import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import axios, { type AxiosAdapter, type InternalAxiosRequestConfig } from 'axios'
import { createFakeHostBridge } from '@omniconnect/host-bridge/testing'

/**
 * The read cache, and the one way a caller is allowed past it.
 *
 * Every GET is served by a caching adapter, which is what makes a double StrictMode mount cost one
 * request. The cost of that is a Refresh button: it re-sends an identical URL, the cache answers it
 * from the stored promise, and nothing reaches the server — the spinner turns and the same rows come
 * back. `fresh: true` is the escape hatch, and these pin it.
 *
 * Note this file stubs `axios.getAdapter` rather than `httpClient.defaults.adapter`, which is what
 * httpClient.test.ts does: assigning defaults.adapter REPLACES the caching adapter, so a test that
 * does it is not exercising the cache at all.
 */

const calls: InternalAxiosRequestConfig[] = []

const countingAdapter: AxiosAdapter = async (config) => {
  calls.push(config)
  return { data: { items: [], totalCount: 0, totalPages: 0 }, status: 200, statusText: '', headers: {}, config }
}

beforeEach(() => {
  vi.resetModules()
  calls.length = 0
  vi.spyOn(axios, 'getAdapter').mockReturnValue(countingAdapter)
  window.__omniconnectHost__ = createFakeHostBridge({
    getAccessToken: () => 'token-1',
    ensureFreshAccessToken: () => Promise.resolve('token-1'),
    getUser: () => ({ id: 'u1', name: 'T', email: 't@example.com', isAdministrator: true }),
  })
})

afterEach(() => {
  vi.restoreAllMocks()
  delete (window as { __omniconnectHost__?: unknown }).__omniconnectHost__
})

async function client() {
  return (await import('./httpClient')).httpClient
}

describe('Products read cache', () => {
  it('answers an identical GET from the cache', async () => {
    const http = await client()

    await http.get('/audit-logs', { params: { page: 1 } })
    await http.get('/audit-logs', { params: { page: 1 } })

    expect(calls).toHaveLength(1)
  })

  it('sends a request for a GET marked fresh, even with identical parameters', async () => {
    const http = await client()

    await http.get('/audit-logs', { params: { page: 1 } })
    await http.get('/audit-logs', { params: { page: 1 }, fresh: true })

    expect(calls).toHaveLength(2)
  })

  it('leaves the fresh answer in the cache for the next reader', async () => {
    const http = await client()

    await http.get('/audit-logs', { params: { page: 1 } })
    await http.get('/audit-logs', { params: { page: 1 }, fresh: true })
    await http.get('/audit-logs', { params: { page: 1 } })

    expect(calls).toHaveLength(2)
  })

  it('refreshes only the query it was asked about', async () => {
    const http = await client()

    await http.get('/audit-logs', { params: { page: 1 } })
    await http.get('/audit-logs', { params: { page: 2 } })
    await http.get('/audit-logs', { params: { page: 1 }, fresh: true })
    await http.get('/audit-logs', { params: { page: 2 } })

    expect(calls).toHaveLength(3)
  })
})
