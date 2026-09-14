import { env } from '../../../config/env'
import { apiFetch } from '../../../shared/api/httpClient'
import { hostDownloadCsv } from '../../../shared/api/exportCsv'
import type { CsvDownloadResult } from '@omniremit/ui'
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
  sourceApplication: string | null
  module: string | null
  page: string | null
  actionCategory: string | null
}

export interface AuditLogSummaryDto {
  loginSuccesses: number
  loginErrors: number
  totalAuditEvents: number
  activeUsers: number
}

export interface ListAuditLogsParams {
  /** "Local" or "Google". Filtered client-side until the audit query became symmetric. */
  authMethod?: string
  /** Substring of the recorded address. */
  sourceIp?: string
  /** A browser or OS name as the detail drawer displays it. */
  device?: string
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
  actorName?: string
  entityType?: string
  entityId?: string
  sourceApplication?: string
  module?: string
  pageName?: string
  actionCategory?: string
}

/** The distinct values each bounded filter can take, given the other filters already applied. */
export interface AuditLogFacetsDto {
  services: string[]
  actions: { action: string; count: number }[]
  authMethods: string[]
  modules: string[]
  pages: string[]
  actionCategories: string[]
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

/*
 * There is deliberately no `recordActivity` here any more, and no `POST /api/audit-logs/activity`
 * for it to call. The browser used to be able to write audit rows naming any service and any
 * module, with no permission check — so the trail recorded what a client asserted rather than what
 * the platform did. Every audit row is now written by the service that performed the action, from
 * the identity on its verified token.
 */
export const auditLogsApi = {
  list: (accessToken: string, params: ListAuditLogsParams = {}, signal?: AbortSignal) =>
    apiFetch<PagedResult<AuditLogDto>>(`${base}/api/audit-logs${buildQuery(params)}`, { accessToken, signal }),

  summary: (accessToken: string, params: DateRangeParams = {}) =>
    apiFetch<AuditLogSummaryDto>(`${base}/api/audit-logs/summary${buildQuery(params)}`, { accessToken }),

  /**
   * The distinct values each bounded filter can take, under the filters already applied.
   *
   * Backs the page's dropdowns now that filtering is server-side. They used to be built from
   * whichever rows had been fetched, which meant a page of ten rows produced a ten-value dropdown —
   * and, even with a large pre-fetch, offered values the other active filters had already excluded.
   */
  facets: (accessToken: string, params: ListAuditLogsParams = {}, signal?: AbortSignal) =>
    apiFetch<AuditLogFacetsDto>(`${base}/api/audit-logs/facets${buildQuery(params)}`, { accessToken, signal }),

  /**
   * Downloads the CSV export.
   *
   * Delegates to the shared helper rather than hand-rolling the fetch, which is what fixes two
   * things at once: the download now refreshes and replays on a stale token like every other request
   * on the page, and it reports whether the server capped the file instead of handing over a partial
   * export that looks complete.
   */
  exportCsv: (accessToken: string | null, params: ListAuditLogsParams = {}): Promise<CsvDownloadResult> =>
    hostDownloadCsv(
      `${base}/api/audit-logs/export${buildQuery(params)}`,
      accessToken,
      `audit-logs-${new Date().toISOString().slice(0, 10)}.csv`,
    ),
}
