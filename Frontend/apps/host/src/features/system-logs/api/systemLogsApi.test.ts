import { beforeEach, describe, expect, it, vi } from 'vitest'
import { systemLogsApi } from './systemLogsApi'

describe('systemLogsApi', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('builds query parameters correctly for list call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        items: [
          {
            id: 'log-1',
            occurredAt: '2026-09-10T00:00:00Z',
            severity: 'Error',
            serviceName: 'AuthService',
            eventCode: 'AUTH_FAIL',
            message: 'Invalid credentials',
            correlationId: 'c-1',
            module: null,
            environment: 'Production',
            tenantId: null,
            userId: null,
            requestId: 'req-1',
            statusCode: 401,
            stackTrace: null,
            metadata: null,
          },
        ],
        total: 1,
        page: 1,
        pageSize: 10,
      }),
    } as Response)

    const res = await systemLogsApi.list('dummy-token', {
      severity: 'Error',
      service: 'AuthService',
      page: 1,
      pageSize: 10,
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const callUrl = fetchSpy.mock.calls[0][0] as string
    expect(callUrl).toContain('/api/system-logs?')
    expect(callUrl).toContain('severity=Error')
    expect(callUrl).toContain('service=AuthService')
    expect(res.items).toHaveLength(1)
    expect(res.items[0].eventCode).toBe('AUTH_FAIL')
  })

  it('calls summary endpoint with date range', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        errorCount: 2,
        warningCount: 5,
        infoCount: 10,
        criticalCount: 1,
        totalEvents: 17,
        servicesReporting: 3,
      }),
    } as Response)

    const summary = await systemLogsApi.summary('dummy-token', {
      from: '2026-09-01T00:00:00Z',
      to: '2026-09-10T00:00:00Z',
    })

    expect(fetchSpy).toHaveBeenCalledTimes(1)
    const callUrl = fetchSpy.mock.calls[0][0] as string
    expect(callUrl).toContain('/api/system-logs/summary?')
    expect(callUrl).toContain('from=2026-09-01T00%3A00%3A00Z')
    expect(summary.errorCount).toBe(2)
    expect(summary.criticalCount).toBe(1)
    expect(summary.totalEvents).toBe(17)
  })

  it('sends messageSearch and environment params to list endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      json: async () => ({ items: [], total: 0, page: 1, pageSize: 10 }),
    } as Response)

    await systemLogsApi.list('dummy-token', {
      messageSearch: 'database',
      environment: 'Production',
    })

    const callUrl = fetchSpy.mock.calls[0][0] as string
    expect(callUrl).toContain('messageSearch=database')
    expect(callUrl).toContain('environment=Production')
  })

  it('sends correlationId to export endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce({
      ok: true,
      blob: async () => new Blob(['time,severity'], { type: 'text/csv' }),
    } as unknown as Response)

    await systemLogsApi.exportCsv('dummy-token', {
      correlationId: 'trace-abc',
      severity: 'Error',
    })

    const callUrl = fetchSpy.mock.calls[0][0] as string
    expect(callUrl).toContain('correlationId=trace-abc')
    expect(callUrl).toContain('severity=Error')
  })
})
