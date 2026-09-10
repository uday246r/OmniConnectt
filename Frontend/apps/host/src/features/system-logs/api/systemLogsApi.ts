import { env } from '../../../config/env'
import { apiFetch, ApiError } from '../../../shared/api/httpClient'
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

  async exportCsv(accessToken: string, params: ListSystemLogsParams = {}): Promise<void> {
    const response = await fetch(`${base}/api/system-logs/export${buildQuery(params)}`, {
      credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}` },
    })

    if (!response.ok) {
      let title = response.statusText || `Request failed with status ${response.status}`
      try {
        const problem = (await response.json()) as { title?: string }
        title = problem.title ?? title
      } catch {
        // body wasn't JSON — keep the status-text fallback
      }
      throw new ApiError(response.status, title)
    }

    const blob = await response.blob()
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `system-logs-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  },
}
