import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CsvExportError, describeTruncation, downloadCsv } from './downloadCsv'

/*
 * This helper replaces four separate CSV downloads that each failed differently, so the tests below
 * are mostly regression guards rather than description.
 *
 * The one worth reading first is the 401 case. The host's two exports bypassed the shared fetch
 * wrapper on purpose — it always parses JSON — and in doing so silently lost its refresh-and-retry,
 * so an export attempted on a token that had just expired failed outright while every other request
 * on the page recovered.
 */

const originalCreateObjectURL = URL.createObjectURL
const originalRevokeObjectURL = URL.revokeObjectURL

beforeEach(() => {
  // jsdom implements neither, and the helper's whole save path goes through them.
  URL.createObjectURL = vi.fn(() => 'blob:mock')
  URL.revokeObjectURL = vi.fn()
})

afterEach(() => {
  URL.createObjectURL = originalCreateObjectURL
  URL.revokeObjectURL = originalRevokeObjectURL
  vi.restoreAllMocks()
})

function csvResponse(headers: Record<string, string> = {}, status = 200) {
  return new Response('Time,Actor\n2026-09-12T00:00:00Z,Priya\n', {
    status,
    headers: { 'Content-Type': 'text/csv', ...headers },
  })
}

function stubFetch(...responses: Response[]) {
  const fetchMock = vi.fn()
  responses.forEach((response) => fetchMock.mockResolvedValueOnce(response))
  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

/**
 * Awaits a download that is expected to be refused and hands back the error, typed.
 *
 * A bare `.catch(e => e as CsvExportError)` widens the result to a union of the success value and
 * the error, so every assertion after it has to re-narrow. This also fails loudly if the call
 * unexpectedly succeeds, which the bare catch would quietly let pass.
 */
async function refusal(promise: Promise<unknown>): Promise<CsvExportError> {
  try {
    await promise
  } catch (e) {
    return e as CsvExportError
  }
  throw new Error('Expected the export to be refused, but it resolved.')
}

describe('downloadCsv', () => {
  it('sends the bearer token and the credentials the refresh cookie needs', async () => {
    const fetchMock = stubFetch(csvResponse())

    await downloadCsv({ url: '/api/audit-logs/export', getAccessToken: async () => 'token-1' })

    const [, init] = fetchMock.mock.calls[0]
    expect(init.headers.Authorization).toBe('Bearer token-1')
    expect(init.credentials).toBe('include')
  })

  /**
   * The named regression: a stale token now refreshes and replays, exactly as every JSON request on
   * the page already did.
   */
  it('refreshes once on a 401 and replays the request', async () => {
    const fetchMock = stubFetch(csvResponse({}, 401), csvResponse())
    const getAccessToken = vi.fn(async (force: boolean) => (force ? 'fresh' : 'stale'))

    await downloadCsv({ url: '/api/audit-logs/export', getAccessToken })

    expect(getAccessToken).toHaveBeenNthCalledWith(1, false)
    expect(getAccessToken).toHaveBeenNthCalledWith(2, true)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[1][1].headers.Authorization).toBe('Bearer fresh')
  })

  /** Exactly once. A second 401 after a fresh token means genuinely not allowed, not stale. */
  it('does not loop when the refreshed token is also refused', async () => {
    const fetchMock = stubFetch(csvResponse({}, 401), csvResponse({}, 401))

    await expect(
      downloadCsv({ url: '/api/audit-logs/export', getAccessToken: async () => 'token' }),
    ).rejects.toBeInstanceOf(CsvExportError)

    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('surfaces a refusal with the message the server gave', async () => {
    stubFetch(
      new Response(JSON.stringify({ title: "You don't have 'Export' access to 'host.system.audit-logs'." }), {
        status: 403,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    const error = await refusal(
      downloadCsv({ url: '/api/audit-logs/export', getAccessToken: async () => 'token' }),
    )

    expect(error).toBeInstanceOf(CsvExportError)
    expect(error.status).toBe(403)
    expect(error.message).toContain("don't have 'Export' access")
  })

  it('falls back to the status text when the failure body is not JSON', async () => {
    stubFetch(new Response('<html>502</html>', { status: 502, statusText: 'Bad Gateway' }))

    const error = await refusal(
      downloadCsv({ url: '/api/audit-logs/export', getAccessToken: async () => 'token' }),
    )

    expect(error.message).toBe('Bad Gateway')
  })

  it('names the file from Content-Disposition, and falls back when there is none', async () => {
    stubFetch(csvResponse({ 'Content-Disposition': 'attachment; filename="audit-logs-20260912.csv"' }))
    const named = await downloadCsv({ url: '/x', getAccessToken: async () => 't' })
    expect(named.filename).toBe('audit-logs-20260912.csv')

    stubFetch(csvResponse())
    const fallback = await downloadCsv({ url: '/x', getAccessToken: async () => 't', filename: 'fallback.csv' })
    expect(fallback.filename).toBe('fallback.csv')
  })

  it('saves the file and releases the object URL', async () => {
    stubFetch(csvResponse())
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    await downloadCsv({ url: '/x', getAccessToken: async () => 't' })

    expect(click).toHaveBeenCalledOnce()
    expect(URL.createObjectURL).toHaveBeenCalledOnce()
    // Not releasing it leaks the blob for the lifetime of the document, and an operator exporting
    // repeatedly is the normal case rather than the unusual one.
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:mock')
  })

  /** The whole reason the servers now count matches separately from rows written. */
  it('reports a truncated export from the response headers', async () => {
    stubFetch(csvResponse({
      'X-Export-Row-Count': '10000',
      'X-Export-Match-Count': '24318',
      'X-Export-Row-Limit': '10000',
      'X-Export-Truncated': 'true',
    }))

    const result = await downloadCsv({ url: '/x', getAccessToken: async () => 't' })

    expect(result).toMatchObject({ truncated: true, rowCount: 10000, matchCount: 24318, rowLimit: 10000 })
  })

  it('reports a complete export as complete', async () => {
    stubFetch(csvResponse({
      'X-Export-Row-Count': '42',
      'X-Export-Match-Count': '42',
      'X-Export-Truncated': 'false',
    }))

    expect((await downloadCsv({ url: '/x', getAccessToken: async () => 't' })).truncated).toBe(false)
  })

  /**
   * The headers only reach the browser if CORS exposes them. If a service ever forgets, the download
   * still works and every export silently reports itself complete — so the counts, when present,
   * are treated as authoritative even without the flag.
   */
  it('infers truncation from the counts when the flag header is missing', async () => {
    stubFetch(csvResponse({ 'X-Export-Row-Count': '100', 'X-Export-Match-Count': '250' }))

    expect((await downloadCsv({ url: '/x', getAccessToken: async () => 't' })).truncated).toBe(true)
  })

  it('reports nothing about truncation when no counting headers are readable at all', async () => {
    stubFetch(csvResponse())

    const result = await downloadCsv({ url: '/x', getAccessToken: async () => 't' })

    expect(result.truncated).toBe(false)
    expect(result.rowCount).toBeNull()
  })
})

describe('describeTruncation', () => {
  it('tells the operator what was left out and what to do about it', () => {
    const message = describeTruncation({
      filename: 'audit-logs.csv',
      rowCount: 10000,
      matchCount: 24318,
      rowLimit: 10000,
      truncated: true,
    })

    expect(message).toContain('10,000')
    expect(message).toContain('24,318')
    expect(message).toContain('Narrow the date range')
  })

  it('says nothing when the export was complete', () => {
    expect(
      describeTruncation({ filename: 'x.csv', rowCount: 5, matchCount: 5, rowLimit: 10000, truncated: false }),
    ).toBeNull()
  })
})
