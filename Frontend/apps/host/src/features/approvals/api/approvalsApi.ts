import { env } from '../../../config/env'
import { apiFetch } from '../../../shared/api/httpClient'
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



export interface ListApprovalsParams {
  page?: number
  pageSize?: number
  module?: string
  status?: ApprovalStatus
  makerId?: string
  assignedToMe?: boolean
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

export const approvalsApi = {
  list: (accessToken: string, params: ListApprovalsParams = {}, signal?: AbortSignal) =>
    apiFetch<PagedResult<ApprovalRequestListItemDto>>(`${base}/api/approvals${buildQuery(params)}`, { accessToken, signal }),

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

}
