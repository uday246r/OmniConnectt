import { env } from '../../../config/env'
import { apiFetch } from '../../../shared/api/httpClient'
import { hostDownloadCsv } from '../../../shared/api/exportCsv'
import type { CsvDownloadResult } from '@omniremit/ui'
import type { PagedResult } from '../../settings-users/api/usersApi'

const base = env.authServiceUrl

export interface SystemLogDto {
  id: string
  occurredAt: string
  severity: string
  serviceName: string
  module: string | null
  environment: string | null
  tenantId: string | null
  userId: string | null
  correlationId: string
  requestId: string | null
  statusCode: number | null
  eventCode: string
  message: string
  stackTrace: string | null
  metadata: string | null
}

export interface SystemLogSummaryDto {
  errorCount: number
  warningCount: number
  infoCount: number
  criticalCount: number
  totalEvents: number
  servicesReporting: number
}

export interface ListSystemLogsParams {
  page?: number
  pageSize?: number
  severity?: string
  service?: string
  module?: string
  eventCode?: string
  from?: string
  to?: string
  sortDir?: 'asc' | 'desc'
  correlationId?: string
  messageSearch?: string
  environment?: string
}

export interface DateRangeParams {
  from?: string
  to?: string
}

function buildQuery(params: object) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params) as [string, string | number | boolean | undefined][]) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

export const systemLogsApi = {
  list: (accessToken: string, params: ListSystemLogsParams = {}, signal?: AbortSignal) =>
    apiFetch<PagedResult<SystemLogDto>>(`${base}/api/system-logs${buildQuery(params)}`, { accessToken, signal }),

  summary: (accessToken: string, params: DateRangeParams = {}) =>
    apiFetch<SystemLogSummaryDto>(`${base}/api/system-logs/summary${buildQuery(params)}`, { accessToken }),

  /**
   * Downloads the CSV export.
   *
   * The hand-rolled fetch this replaces bypassed {@link apiFetch} — necessarily, since that always
   * parses JSON — and in doing so lost its 401-refresh-and-retry, so an export on a token that had
   * just expired failed while every other request on the page recovered. It also could not tell the
   * caller when the server had capped the file.
   */
  exportCsv: (accessToken: string | null, params: ListSystemLogsParams = {}): Promise<CsvDownloadResult> =>
    hostDownloadCsv(
      `${base}/api/system-logs/export${buildQuery(params)}`,
      accessToken,
      `system-logs-${new Date().toISOString().slice(0, 10)}.csv`,
    ),
}
