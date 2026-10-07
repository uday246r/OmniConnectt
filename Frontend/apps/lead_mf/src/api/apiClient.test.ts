import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createFakeHostBridge } from '@omniconnect/host-bridge/testing'

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
  window.__omniconnectHost__ = createFakeHostBridge({
    hasCapability: () => true,
    getUser: () => ({ id: userId, name: 'T', email: 't@example.com', isAdministrator: true }),
  })
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

  it('sends a second request when Refresh asks for a fresh read', async () => {
    // The bug this covers: Refresh re-sent an identical URL, the 30s cache answered it from memory,
    // and no request left the browser — so the button spun and re-rendered the same rows.
    fetchMock.mockImplementation(() =>
      Promise.resolve(ok({ success: true, data: { items: [], totalRecords: 0, page: 1, pageSize: 10, totalPages: 0 } })),
    )
    const api = await client()

    await api.getLeads({ page: 1, pageSize: 10 })
    await api.getLeads({ page: 1, pageSize: 10 })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await api.getLeads({ page: 1, pageSize: 10, fresh: true })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('sends a second request when the audit log is refreshed', async () => {
    fetchMock.mockImplementation(() =>
      Promise.resolve(ok({ success: true, data: { items: [], totalRecords: 0, page: 1, pageSize: 10, totalPages: 0 } })),
    )
    const api = await client()

    await api.getAuditLogs({ page: 1, pageSize: 10 })
    await api.getAuditLogs({ page: 1, pageSize: 10 })
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await api.getAuditLogs({ page: 1, pageSize: 10, fresh: true })

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reports a failed read instead of answering with an empty page', async () => {
    // An empty list and an unreachable server are different answers. Returning [] for both made a
    // failed refresh look exactly like a table that had been emptied.
    fetchMock.mockImplementation(() => Promise.resolve(new Response('{}', { status: 500 })))
    const api = await client()

    await expect(api.getAuditLogs({ page: 1, pageSize: 10 })).rejects.toThrow(/could not be loaded/i)
    await expect(api.getLeads({ page: 1, pageSize: 10 })).rejects.toThrow(/could not be loaded/i)
  })

  it('does not reuse an error response', async () => {
    fetchMock
      .mockResolvedValueOnce(new Response('{}', { status: 500 }))
      .mockResolvedValueOnce(ok({ success: true, data: [{ value: 'Selangor', label: 'Selangor' }] }))
    const api = await client()

    await expect(api.getStates()).resolves.toEqual([])
    await expect(api.getStates()).resolves.toEqual([{ value: 'Selangor', label: 'Selangor' }])
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

describe('Product catalogue reads', () => {
  const category = { id: 'c1', name: 'Loans', code: 'LN', iconKey: '', productCount: 2 }

  it('is never served from the cache, so a category switched off in the Marketplace disappears at once', async () => {
    fetchMock.mockImplementation(() => Promise.resolve(ok({ success: true, data: [category] })))
    const api = await client()

    await api.getCatalogCategories()
    await api.getCatalogCategories()

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('says so when the catalogue cannot be read, rather than returning an empty list that reads as "nothing on offer"', async () => {
    fetchMock.mockResolvedValue(new Response('{}', { status: 503 }))
    const api = await client()

    await expect(api.getCatalogCategories()).rejects.toThrow(/could not be loaded/)
    await expect(api.getCatalogProducts('c1')).rejects.toThrow(/could not be loaded/)
  })

  it('asks for the products of one category', async () => {
    fetchMock.mockResolvedValue(ok({ success: true, data: [] }))
    const api = await client()

    await api.getCatalogProducts('c1')

    expect(String(fetchMock.mock.calls[0][0])).toContain('/api/catalog/categories/c1/products')
  })
})

describe('What a lead sends for its product', () => {
  it('sends the catalogue id and never the sub-category', async () => {
    const { toLeadPayload } = await import('./apiClient')

    expect(toLeadPayload({ product: 'Home Loan', catalogProductId: 'p1', subCategoryId: 's1', email: 'a@b.c' }))
      .toEqual({ product: 'Home Loan', catalogProductId: 'p1', email: 'a@b.c' })
  })

  it('leaves the id out for a lead taken before the catalogue existed, since an empty string is not a valid id', async () => {
    const { toLeadPayload } = await import('./apiClient')

    expect(toLeadPayload({ product: 'ASB Financing', catalogProductId: '', subCategoryId: '' })).toEqual({ product: 'ASB Financing' })
  })
})
