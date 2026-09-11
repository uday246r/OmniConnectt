import { env } from '../../../config/env'
import { apiFetch } from '../../../shared/api/httpClient'
import type { PagedResult } from '../../settings-users/api/usersApi'
import type { ApprovalPendingDto } from '../../approvals/api/approvalsApi'

const base = env.authServiceUrl

export type RemoteAppStatus = 'Active' | 'Maintenance' | 'Disabled'

/** Reachability of a remote app, as last observed by AuthService's background probe. */
export type RemoteAppHealth = 'Unknown' | 'Healthy' | 'Unreachable'

/**
 * One row of the health feed.
 *
 * It carries `displayName` as well as `key` because the shell uses this single feed for two jobs:
 * the sidebar's "not responding" badge and the dashboard panel, and turning a raw permission string
 * like `remote.lead:View` into readable text on the profile and user-detail screens. A second
 * endpoint returning a near-duplicate list of apps used to serve the latter.
 */
export interface HealthEntryDto {
  key: string
  displayName: string
  health: RemoteAppHealth
  lastCheckedAt: string | null
  error: string | null
}

/**
 * Upper bound on how long the shell waits for a health poll.
 *
 * A refused connection settles on its own, but a server that accepts the socket and then stalls does
 * not — and an un-deadlined poll on a timer would pile up pending requests indefinitely.
 */
const HEALTH_TIMEOUT_MS = 8000

export interface RemoteAppDto {
  id: string
  key: string
  displayName: string
  iconKey: string | null
  manifestUrl: string
  sidebarOrder: number
  status: RemoteAppStatus
  maintenanceMessage: string | null
  permissionFeatureKey: string
  permissionsSourceUrl: string | null
  createdAt: string
  updatedAt: string
}

export interface CreateRemoteAppRequest {
  key: string
  displayName: string
  iconKey?: string | null
  manifestUrl: string
  permissionsSourceUrl?: string | null
  sidebarOrder?: number
}

export interface UpdateRemoteAppRequest {
  displayName: string
  iconKey?: string | null
  manifestUrl: string
  permissionsSourceUrl?: string | null
  sidebarOrder: number
}

export interface ListRemoteAppsParams {
  page?: number
  pageSize?: number
  search?: string
}

function buildQuery(params: object) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params) as [string, string | number | boolean | undefined][]) {
    if (value !== undefined) search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

export const remoteAppsApi = {
  /*
   * Read-only listing, given a deadline because the dashboard renders it alongside data from a
   * different service (AuthService). A caller's `.catch()` fallback only runs if the promise SETTLES;
   * a refused connection settles on its own, but a registry that accepts the socket and then stalls
   * does not, and would hold the whole dashboard on skeletons rather than degrading one card.
   *
   * Mutations are deliberately left without a timeout: aborting a write tells you nothing about
   * whether the server applied it.
   */
  list: (accessToken: string, params: ListRemoteAppsParams = {}, signal?: AbortSignal) =>
    apiFetch<PagedResult<RemoteAppDto>>(`${base}/api/remote-apps${buildQuery(params)}`, {
      accessToken,
      // Combined, not replaced: the 8s ceiling still applies, and the caller can additionally
      // cancel early when its effect tears down.
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(8000)]) : AbortSignal.timeout(8000),
    }),

  get: (accessToken: string, id: string) => apiFetch<RemoteAppDto>(`${base}/api/remote-apps/${id}`, { accessToken }),

  // Resolves the real RemoteAppDto (200/201, applied as it always has) or an ApprovalPendingDto (202)
  // if the "Applications" module has a checker assigned — callers must branch with isApprovalPending()
  // before treating the result as the real thing.
  create: (accessToken: string, body: CreateRemoteAppRequest) =>
    apiFetch<RemoteAppDto | ApprovalPendingDto>(`${base}/api/remote-apps`, { method: 'POST', accessToken, body }),

  update: (accessToken: string, id: string, body: UpdateRemoteAppRequest) =>
    apiFetch<RemoteAppDto | ApprovalPendingDto>(`${base}/api/remote-apps/${id}`, { method: 'PUT', accessToken, body }),

  updateStatus: (accessToken: string, id: string, status: RemoteAppStatus, maintenanceMessage?: string | null) =>
    apiFetch<RemoteAppDto | ApprovalPendingDto>(`${base}/api/remote-apps/${id}/status`, {
      method: 'PATCH',
      accessToken,
      body: { status, maintenanceMessage },
    }),

  /** Resolves `undefined` on the ungated path (204, deleted for real) or an ApprovalPendingDto (202) if gated. */
  remove: (accessToken: string, id: string) =>
    apiFetch<ApprovalPendingDto | undefined>(`${base}/api/remote-apps/${id}`, { method: 'DELETE', accessToken }),

  resyncPermissions: (accessToken: string) =>
    apiFetch<{ resyncedCount: number }>(`${base}/api/remote-apps/resync-permissions`, { method: 'POST', accessToken }),

  /**
   * Last observed reachability of every app the caller can see. Any authenticated user — filtered
   * server-side to what their token grants, so it reveals nothing the sidebar does not.
   */
  health: (accessToken: string, signal?: AbortSignal) =>
    apiFetch<HealthEntryDto[]>(`${base}/api/remote-apps/health`, {
      accessToken,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(HEALTH_TIMEOUT_MS)]) : AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    }),

  /**
   * Asks the server to probe the remotes NOW rather than return what its last background sweep
   * stored. Throttled server-side, so holding down refresh cannot become a probe storm.
   */
  refreshHealth: (accessToken: string, signal?: AbortSignal) =>
    apiFetch<HealthEntryDto[]>(`${base}/api/remote-apps/health/refresh`, {
      method: 'POST',
      accessToken,
      signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(HEALTH_TIMEOUT_MS)]) : AbortSignal.timeout(HEALTH_TIMEOUT_MS),
    }),
}
