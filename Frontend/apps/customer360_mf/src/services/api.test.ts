import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Customer 360 reads share requests, but a customer lookup is never answered from cache.
 *
 * StrictMode and pages that load the same lookups and field configuration used to send those requests
 * in pairs, so identical overlapping reads now share one request and configuration is reused briefly.
 * The line that must not move: the server writes an audit row each time it serves a customer profile,
 * so a separate lookup of a customer has to reach the server every time — reusing that response would
 * quietly drop audit entries.
 */

const fetchMock = vi.fn()

function ok(body: unknown) {
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' } }))
}

beforeEach(() => {
  vi.resetModules()
  fetchMock.mockReset()
  fetchMock.mockImplementation(() => ok({ status: 200, data: [] }))
  vi.stubGlobal('fetch', fetchMock)
  window.__omniconnectHost__ = {
    getAccessToken: () => 'token',
    ensureFreshAccessToken: () => Promise.resolve('token'),
    hasCapability: () => true,
    getUser: () => ({ id: 'u1', name: 'T', email: 't@example.com', isAdministrator: true, roleName: null, permissions: [] }),
  } as never
})

afterEach(() => {
  vi.unstubAllGlobals()
  delete (window as { __omniconnectHost__?: unknown }).__omniconnectHost__
})

async function api() {
  return (await import('./api')).api
}

describe('Customer 360 read cache', () => {
  it('shares one request for overlapping identical reads and reuses configuration', async () => {
    const client = await api()

    await Promise.all([client.getSearchOptions(), client.getSearchOptions()])
    await client.getFieldConfig('Individual')
    await client.getFieldConfig('Individual')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('sends every separate customer lookup to the server, so each one is audited', async () => {
    const client = await api()

    await client.getIndividualProfile('900101015555')
    await client.getIndividualProfile('900101015555')

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('reads configuration fresh after it is saved', async () => {
    const client = await api()
    await client.getFieldConfig('Corporate')

    await client.updateFieldConfig('Corporate', [])
    await client.getFieldConfig('Corporate')

    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('gives each caller its own copy of the data', async () => {
    fetchMock.mockImplementation(() => ok({ status: 200, data: [{ fieldKey: 'name', visible: true }] }))
    const client = await api()

    const first = await client.getFieldConfig('Individual')
    ;(first.data[0] as { visible: boolean }).visible = false
    const second = await client.getFieldConfig('Individual')

    expect((second.data[0] as { visible: boolean }).visible).toBe(true)
  })
})
