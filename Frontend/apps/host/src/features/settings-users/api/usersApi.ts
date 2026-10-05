import { env } from '../../../config/env'
import { apiFetch } from '../../../shared/api/httpClient'
import type { ApprovalPendingDto } from '../../approvals/api/approvalsApi'

const base = env.authServiceUrl

export interface PagedResult<T> {
  items: T[]
  total: number
  page: number
  pageSize: number
}

export type AuthProviderValue = 'Local' | 'Google'

export interface UserListItemDto {
  id: string
  salutation: string | null
  name: string
  email: string
  phoneNumber: string | null
  roleId: string | null
  roleName: string | null
  isAdministrator: boolean
  isActive: boolean
  lastLoginAt: string | null
  authProvider: AuthProviderValue
  /** No invite has been redeemed for this account yet, so it cannot be signed into — offer a resend. */
  awaitingPasswordSetup: boolean
}

export interface PermissionOverrideDto {
  featureKey: string
  capability: string
  effect: 'Grant' | 'Revoke'
}

export interface UserDetailDto {
  id: string
  salutation: string | null
  name: string
  email: string
  phoneNumber: string | null
  roleId: string | null
  roleName: string | null
  isAdministrator: boolean
  isActive: boolean
  mustChangePassword: boolean
  lastLoginAt: string | null
  createdAt: string
  updatedAt: string
  permissionOverrides: PermissionOverrideDto[]
  authProvider: AuthProviderValue
  /** Values for admin-defined custom fields (e.g. "aadharNumber") — see UserFieldSchema. */
  customFields: Record<string, string> | null
  passwordChangedAt?: string | null
  passwordExpiresAt?: string | null
  isPasswordExpired?: boolean
}

/** authProvider defaults "Local" and is immutable after creation — see the backend DTO's doc comment. */
export interface CreateUserRequest {
  name: string
  email: string
  phoneNumber?: string | null
  roleId?: string | null
  isActive?: boolean
  authProvider?: AuthProviderValue
  /** Values for admin-defined custom fields from the current UserFieldSchema (e.g. "aadharNumber"). */
  customFields?: Record<string, string> | null
  /** Title/salutation (Mr., Ms., ...) — must be one of the current SalutationCatalog entries, or omitted. */
  salutation?: string | null
}

/**
 * `inviteEmailed` false means the account exists but nobody can sign into it yet — the set-password
 * link never went out. Recoverable with `usersApi.resendInvite` once mail is working.
 */
export interface CreateUserResponse {
  user: UserDetailDto
  inviteEmailed: boolean
}

export interface ResendInviteResponse {
  emailed: boolean
}

export interface UpdateUserRequest {
  name: string
  email: string
  phoneNumber?: string | null
  roleId?: string | null
  /**
   * Whether the account may sign in.
   *
   * The edit form has always shown an "Account is Active" toggle, but neither this type nor the
   * server's UpdateUserRequest carried the field — so the toggle moved, the form saved, and the status
   * silently did not change. Status is edited here rather than from a list row, so this is the field
   * that actually applies it.
   */
  isActive: boolean

  /** Same as CreateUserRequest.customFields. */
  customFields?: Record<string, string> | null
  /** Same as CreateUserRequest.salutation. */
  salutation?: string | null
}

/**
 * Filters the server applies to the whole directory (the server caps a page at 100 rows, so nothing
 * may be filtered or counted in the browser over one page of it).
 */
export interface UserFilterParams {
  /** Name, email, role name, or digits of the mobile number. */
  search?: string
  /** Name or email contains. */
  name?: string
  /** Digits the mobile number contains, formatting ignored. */
  phone?: string
  /** A role's exact name, or {@link NO_ROLE_LABEL}. */
  role?: string
  isActive?: boolean
  roleId?: string
  /** ISO instants bounding the last sign-in. A user who never signed in is outside any bounded range. */
  lastLoginFrom?: string
  lastLoginTo?: string
}

export interface ListUsersParams extends UserFilterParams {
  page?: number
  pageSize?: number
}

/** The value the list and the Role filter use for a user without a role; the server accepts it as a filter. */
export const NO_ROLE_LABEL = 'No Role'

export interface UserDirectorySummaryDto {
  total: number
  active: number
  inactive: number
  administrators: number
}

export interface UserListFacetsDto {
  roles: string[]
}

function buildQuery(params: object) {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params) as [string, string | number | boolean | undefined][]) {
    if (value !== undefined && value !== '') search.set(key, String(value))
  }
  const query = search.toString()
  return query ? `?${query}` : ''
}

export const usersApi = {
  list: (accessToken: string, params: ListUsersParams = {}, signal?: AbortSignal) =>
    apiFetch<PagedResult<UserListItemDto>>(`${base}/api/users${buildQuery(params)}`, { accessToken, signal }),

  /** Counts for the whole directory, independent of any filter. */
  summary: (accessToken: string, signal?: AbortSignal) =>
    apiFetch<UserDirectorySummaryDto>(`${base}/api/users/summary`, { accessToken, signal }),

  /** Role filter options under the other filters (the role filter itself is ignored). */
  facets: (accessToken: string, params: UserFilterParams = {}, signal?: AbortSignal) =>
    apiFetch<UserListFacetsDto>(`${base}/api/users/facets${buildQuery(params)}`, { accessToken, signal }),

  get: (accessToken: string, id: string) => apiFetch<UserDetailDto>(`${base}/api/users/${id}`, { accessToken }),

  // Every mutation below returns the real result on the ungated path (identical to before Maker-Checker
  // existed) or an ApprovalPendingDto (202) if the "Users" module has a checker assigned — callers must
  // branch with isApprovalPending() before treating the result as the real thing.
  //
  // create/update bundle the Extra Permissions grid into the SAME call as the core fields — this used
  // to be two separate requests (core fields, then a follow-up replaceOverrides call), and the
  // follow-up was silently skipped whenever the first was gated, discarding whatever permission
  // changes were part of that same edit with no error and no audit trail. Bundling means a checker
  // reviews and approves both together, and approval actually applies both.
  // overrides is genuinely optional (undefined, not defaulted to []) — omitting it means "leave
  // existing overrides untouched" (see ProfilePage's self-service edit, which never touches
  // permissions), while passing [] explicitly means "the admin wants zero overrides". The backend
  // tells these apart the same way: a JSON body with no "overrides" key binds to null server-side and
  // is skipped; an explicit empty array is applied.
  create: (accessToken: string, user: CreateUserRequest, overrides?: PermissionOverrideDto[]) =>
    apiFetch<CreateUserResponse | ApprovalPendingDto>(`${base}/api/users`, { method: 'POST', accessToken, body: { user, overrides } }),

  update: (accessToken: string, id: string, user: UpdateUserRequest, overrides?: PermissionOverrideDto[]) =>
    apiFetch<UserDetailDto | ApprovalPendingDto>(`${base}/api/users/${id}`, { method: 'PUT', accessToken, body: { user, overrides } }),

  updateStatus: (accessToken: string, id: string, isActive: boolean) =>
    apiFetch<UserDetailDto | ApprovalPendingDto>(`${base}/api/users/${id}/status`, { method: 'PATCH', accessToken, body: { isActive } }),

  /** Resolves `undefined` on the ungated path (204, deleted for real) or an ApprovalPendingDto (202) if gated. */
  remove: (accessToken: string, id: string) =>
    apiFetch<ApprovalPendingDto | undefined>(`${base}/api/users/${id}`, { method: 'DELETE', accessToken }),

  /**
   * Emails the user a fresh set-password link, replacing any earlier one. Not approval-gated: a link
   * held for a checker would expire before it was ever sent. Rejects with an ApiError carrying the
   * reason when the account is not awaiting setup, or when another invite went out moments ago.
   */
  resendInvite: (accessToken: string, id: string) =>
    apiFetch<ResendInviteResponse>(`${base}/api/users/${id}/resend-invite`, { method: 'POST', accessToken }),

  getOverrides: (accessToken: string, id: string) =>
    apiFetch<PermissionOverrideDto[]>(`${base}/api/users/${id}/permission-overrides`, { accessToken }),

  /** Now also gated (previously an open side door around Users gating regardless of the bundled
   * update flow above) — most callers should prefer bundling overrides into update()/create() instead
   * of calling this directly, since that gives a checker one coherent request to review. */
  replaceOverrides: (accessToken: string, id: string, overrides: PermissionOverrideDto[]) =>
    apiFetch<PermissionOverrideDto[] | ApprovalPendingDto>(`${base}/api/users/${id}/permission-overrides`, {
      method: 'PUT',
      accessToken,
      body: { overrides },
    }),
}
