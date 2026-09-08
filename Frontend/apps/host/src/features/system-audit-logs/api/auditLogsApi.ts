import { env } from '../../../config/env'
import { apiFetch, ApiError } from '../../../shared/api/httpClient'
import type { PagedResult } from '../../settings-users/api/usersApi'

const base = env.authServiceUrl

export type AuditResult = 'Success' | 'Failure'

export interface AuditLogDto {
  id: string
  occurredAt: string
  serviceName: string
  actorUserId: string | null
  actorName: string | null
  action: string
  entityType: string | null
  entityId: string | null
  entityLabel: string | null
  details: string | null
  sourceIp: string | null
  authMethod: string | null
  result: AuditResult
  userAgent: string | null
  failureReason: string | null
  correlationId: string
}

export interface AuditLogSummaryDto {
  loginSuccesses: number
  loginErrors: number
  totalAuditEvents: number
  activeUsers: number
}

export interface ListAuditLogsParams {
  page?: number
  pageSize?: number
  service?: string
  action?: string
  result?: AuditResult
  from?: string
  to?: string
  sortDir?: 'asc' | 'desc'
  /** Scopes the list to a single actor's history — e.g. a user's Audit Log tab. */
  actorUserId?: string
  /** Scopes the list to every row stamped with one operation's id — see AuditLogDetailDrawer's "Related Activity". */
  correlationId?: string
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

export const auditLogsApi = {
  list: (accessToken: string, params: ListAuditLogsParams = {}, signal?: AbortSignal) =>
    apiFetch<PagedResult<AuditLogDto>>(`${base}/api/audit-logs${buildQuery(params)}`, { accessToken, signal }),

  summary: (accessToken: string, params: DateRangeParams = {}) =>
    apiFetch<AuditLogSummaryDto>(`${base}/api/audit-logs/summary${buildQuery(params)}`, { accessToken }),

  /**
   * Downloads the CSV export as a real browser file-save (not apiFetch — that always parses JSON).
   * Uses a temporary object URL + anchor click, the standard client-side download pattern; the
   * blob's bytes are exactly what the server produced, nothing constructed client-side.
   */
  async exportCsv(accessToken: string, params: ListAuditLogsParams = {}): Promise<void> {
    const response = await fetch(`${base}/api/audit-logs/export${buildQuery(params)}`, {
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
    link.download = `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(url)
  },
}
