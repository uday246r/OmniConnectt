import { env } from '../../../config/env'
import { apiFetch } from '../../../shared/api/httpClient'

const base = env.authServiceUrl

/** One module the Checker Assignment UI may offer a checker for — AuthService's own Users/Roles, or a
 * live PermissionFeature.Key from any registered remote app. Sourced from the same dynamic capability
 * catalog the Role editor renders, so a new remote app's module shows up here the moment it
 * registers/syncs — no code change, here or in AuthService, when a future remote app is added. */
export interface AssignableModuleDto {
  key: string
  label: string
}

/**
 * An assignment targets a specific user OR a role — exactly one of `checkerUserId` and
 * `checkerRoleId` is set. `checkerName` carries whichever name applies so the UI has a single field
 * to render, and `isRole` says which kind it is.
 */
export interface CheckerAssignmentDto {
  id: string
  module: string
  checkerUserId: string | null
  checkerRoleId: string | null
  checkerName: string
  isRole: boolean
  /**
   * Active members the role currently expands to; null for a user assignment. Worth surfacing:
   * "assigned to Manager" says nothing about whether anyone can actually approve today.
   */
  memberCount: number | null
  createdAt: string
}

/** Supply exactly one of the two ids. */
export interface UpsertCheckerAssignmentRequest {
  module: string
  checkerUserId?: string
  checkerRoleId?: string
}

/** Assigns one checker to every module in `modules` in a single call — supply exactly one of the two ids. */
export interface BulkUpsertCheckerAssignmentRequest {
  modules: string[]
  checkerUserId?: string
  checkerRoleId?: string
}

export const checkerAssignmentsApi = {
  list: (accessToken: string, module?: string) =>
    apiFetch<CheckerAssignmentDto[]>(`${base}/api/checker-assignments${module ? `?module=${encodeURIComponent(module)}` : ''}`, { accessToken }),

  listModules: (accessToken: string) =>
    apiFetch<AssignableModuleDto[]>(`${base}/api/checker-assignments/modules`, { accessToken }),

  upsert: (accessToken: string, body: UpsertCheckerAssignmentRequest) =>
    apiFetch<CheckerAssignmentDto>(`${base}/api/checker-assignments`, { method: 'POST', accessToken, body }),

  bulkUpsert: (accessToken: string, body: BulkUpsertCheckerAssignmentRequest) =>
    apiFetch<CheckerAssignmentDto[]>(`${base}/api/checker-assignments/bulk`, { method: 'POST', accessToken, body }),

  remove: (accessToken: string, id: string) =>
    apiFetch<void>(`${base}/api/checker-assignments/${id}`, { method: 'DELETE', accessToken }),
}
