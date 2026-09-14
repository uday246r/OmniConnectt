import { env } from '../../../config/env'
import { apiFetch } from '../../../shared/api/httpClient'
import { hostDownloadCsv } from '../../../shared/api/exportCsv'
import type { CsvDownloadResult } from '@omniremit/ui'
import type { PagedResult } from '../../settings-users/api/usersApi'

const base = env.authServiceUrl

export type ApprovalStatus = 'Pending' | 'Approved' | 'Rejected'
export type ApprovalAction = 'Create' | 'Update' | 'Delete' | 'Enable' | 'Disable'

export interface ApprovalRequestListItemDto {
  id: string
  module: string
  action: ApprovalAction
  entityType: string | null
  entityLabel: string | null
  status: ApprovalStatus
  makerId: string
  makerName: string | null
  checkerId: string
  checkerName: string | null
  requestedAt: string
  decidedAt: string | null
  rejectionReason: string | null
  /** True only for the caller's own approved Create-User requests whose one-time temporary
   * password has not been collected yet. Carries no secret — just "there is something to collect". */
  hasTempPassword: boolean
}

export interface ApprovalRequestDetailDto {
  id: string
  module: string
  action: ApprovalAction
  entityType: string | null
  entityId: string | null
  entityLabel: string | null
  oldDataJson: string | null
  newDataJson: string
  status: ApprovalStatus
  makerId: string
  makerName: string | null
  checkerId: string
  checkerName: string | null
  requestedAt: string
  decidedAt: string | null
  rejectionReason: string | null
}

export interface ApprovalSummaryDto {
  pendingTotal: number
  approvedToday: number
  rejectedToday: number
  assignedToMePending: number
}

/**
 * Returned by any gated mutation (create/update/delete/enable/disable a User or Role, in Phase 1)
 * instead of the normal success body — the change was NOT applied, an approval request was queued.
 * HTTP 202. Every mutation method across usersApi/rolesApi (and Phase 2's remote-app equivalents)
 * returns `ActualResponse | ApprovalPendingDto`; call `isApprovalPending()` to branch on it.
 */
export interface ApprovalPendingDto {
  approvalRequestId: string
  module: string
  action: ApprovalAction
  checkerName: string
  message: string
}

export function isApprovalPending(value: unknown): value is ApprovalPendingDto {
  return typeof value === 'object' && value !== null && 'approvalRequestId' in value && 'message' in value
}

/**
 * The one and only time this value is ever transmitted. Returned once by
 * POST /api/approvals/{id}/reveal-temp-password to the request's maker — a second call answers 410.
 */
export interface RevealTempPasswordResponse {
  temporaryPassword: string
  userName: string
  userEmail: string
}

/** The Approval Center's dropdown options, under the filters already applied. */
export interface ApprovalFacetsDto {
  modules: string[]
  actions: string[]
  makers: string[]
  checkers: string[]
}

export interface ListApprovalsParams {
  page?: number
  pageSize?: number
  module?: string
  /** One status, or several comma-separated — `'Approved,Rejected'` is the Processed tab. */
  status?: ApprovalStatus | `${ApprovalStatus},${ApprovalStatus}`
  action?: ApprovalAction
  makerId?: string
  /** Case-insensitive substrings, matched by the server — these were browser-side filters over 200 rows. */
  makerName?: string
  checkerName?: string
  entityLabel?: string
  /** `'decided'` orders by decision time, newest first. */
  sortBy?: 'requested' | 'decided'
  assignedToMe?: boolean
  /** Bounds on when the request was RAISED. */
  from?: string
  to?: string
  /**
   * Bounds on when it was DECIDED. Server-side now — the Approval Center offered this filter and
   * applied it in the browser over the page it had already fetched, so "approved last week" meant
   * "approved last week, among the rows that happened to be loaded".
   */
  decidedFrom?: string
  decidedTo?: string
}

function buildQuery(params: object) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params) as [string, string | number | boolean | undefined][]) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

export const approvalsApi = {
  list: (accessToken: string, params: ListApprovalsParams = {}, signal?: AbortSignal) =>
    apiFetch<PagedResult<ApprovalRequestListItemDto>>(`${base}/api/approvals${buildQuery(params)}`, { accessToken, signal }),

  /** Distinct modules, actions, makers and checkers under the same filters the list is given. */
  facets: (accessToken: string, params: ListApprovalsParams = {}, signal?: AbortSignal) =>
    apiFetch<ApprovalFacetsDto>(`${base}/api/approvals/facets${buildQuery(params)}`, { accessToken, signal }),

  /**
   * The approval queue as a CSV file.
   *
   * New. This is the platform's record of every gated change and who decided it, and it was the only
   * log-shaped screen with no export at all — producing evidence of a period's approvals meant
   * taking screenshots.
   */
  exportCsv: (accessToken: string | null, params: ListApprovalsParams = {}): Promise<CsvDownloadResult> =>
    hostDownloadCsv(
      `${base}/api/approvals/export${buildQuery(params)}`,
      accessToken,
      `approvals-${new Date().toISOString().slice(0, 10)}.csv`,
    ),

  /** "My Requests" — the maker's own submissions, regardless of whether they hold Approval Center access. */
  listMine: (
    accessToken: string,
    params: { page?: number; pageSize?: number; status?: ApprovalStatus } = {},
    signal?: AbortSignal,
  ) =>
    apiFetch<PagedResult<ApprovalRequestListItemDto>>(`${base}/api/approvals/mine${buildQuery(params)}`, { accessToken, signal }),

  get: (accessToken: string, id: string) =>
    apiFetch<ApprovalRequestDetailDto>(`${base}/api/approvals/${id}`, { accessToken }),

  summary: (accessToken: string) =>
    apiFetch<ApprovalSummaryDto>(`${base}/api/approvals/summary`, { accessToken }),

  approve: (accessToken: string, id: string) =>
    apiFetch<ApprovalRequestDetailDto>(`${base}/api/approvals/${id}/approve`, { method: 'POST', accessToken }),

  reject: (accessToken: string, id: string, reason: string) =>
    apiFetch<ApprovalRequestDetailDto>(`${base}/api/approvals/${id}/reject`, { method: 'POST', accessToken, body: { reason } }),

  /** Collects the one-time temporary password for an approved Create-User request. Succeeds
   * exactly once per request — a second call answers 410. Maker-only; the server enforces ownership. */
  revealTempPassword: (accessToken: string, id: string) =>
    apiFetch<RevealTempPasswordResponse>(`${base}/api/approvals/${id}/reveal-temp-password`, { method: 'POST', accessToken }),
}
