import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { OmniConnectHostBridge } from './hostBridge'

/**
 * Every Lead read goes through one request cache.
 *
 * The layout and each page used to load the same dashboard, lead list and reference data, and
 * StrictMode mounts effects twice, so the dashboard sent each chart request four times and those copies
 * queued behind the browser's six connections per origin. These tests hold the API layer to what the
 * pages now rely on: overlapping identical reads cost one request, a write makes the next read fresh,
 * an error is never reused, and a different signed-in user never gets the previous user's response.
 */

let userId = 'u1'
const fetchMock = vi.fn()

function ok(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ETag: '"v1"' } })
}

beforeEach(() => {
  vi.resetModules()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  userId = 'u1'
  window.__omniconnectHost__ = {
    getAccessToken: () => 'token',
    ensureFreshAccessToken: () => Promise.resolve('token'),
    hasCapability: () => true,
    getUser: () => ({ id: userId, name: 'T', email: 't@example.com', isAdministrator: true, roleName: null, permissions: [] }),
  } as OmniConnectHostBridge
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete window.__omniconnectHost__
})

async function client() {
  return (await import('./apiClient')).apiClient
}

describe('Lead API read cache', () => {
  it('sends one request when the same data is asked for twice at once', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(ok({ success: true, data: [{ value: 'Selangor', label: 'Selangor' }] })))
    const api = await client()

    const [a, b] = await Promise.all([api.getStates(), api.getStates()])

    expect(fetchMock).toHaveBeenCalledTimes(1)
    expect(a).toEqual(b)
    expect(a[0].label).toBe('Selangor')
  })

  it('reads fresh data after a write', async () => {
    fetchMock.mockImplementation((_url: string, init?: RequestInit) =>
      Promise.resolve(init?.method === 'DELETE' ? ok({ success: true, data: true }) : ok({ success: true, data: { items: [], totalRecords: 0, page: 1, pageSize: 10, totalPages: 0 } })),
    )
    const api = await client()

    await api.getLeads({ page: 1, pageSize: 10 })
    await api.getLeads({ page: 1, pageSize: 10 })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await api.deleteLead('lead-1', 'duplicate')
    await api.getLeads({ page: 1, pageSize: 10 })

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('does not reuse an error response', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(ok({ success: true, data: [{ value: 'Home', label: 'Home' }] }))
    const api = await client()

    await expect(api.getProducts()).resolves.toEqual([])
    await expect(api.getProducts()).resolves.toEqual([{ value: 'Home', label: 'Home' }])
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('never gives one signed-in user the response cached for another', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(ok({ success: true, data: [] })))
    const api = await client()

    await api.getStates()
    userId = 'u2'
    await api.getStates()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('loads field settings for editing straight from the server with its version tag', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(ok({ success: true, data: [] })))
    const api = await client()

    await api.getFieldConfig('p1')
    const editing = await api.getFieldConfigForEditing('p1')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(editing.version).toBe('"v1"')
  })
})
