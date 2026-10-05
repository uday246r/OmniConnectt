import { env } from '../../../config/env'
import { apiFetch } from '../../../shared/api/httpClient'

const base = env.authServiceUrl

/** A role's own password lifetime. A role with no entry inherits the global one. */
export interface RolePasswordExpiry {
  roleId: string
  expiryDays: number
}

/** When and where the advance-expiry warning goes out. */
export interface PasswordExpiryNotification {
  email: boolean
  inApp: boolean
  /** Days before expiry, largest first, e.g. [14, 7, 3, 1]. */
  leadDays: number[]
}

/** What a NEW password must satisfy. Global — roles differ in how long a password lives, not in what a good one is. */
export interface PasswordComplexity {
  minimumLength: number
  maximumLength: number
  requireUppercase: boolean
  requireLowercase: boolean
  requireDigit: boolean
  requireNonAlphanumeric: boolean
  rejectSameAsCurrent: boolean
}

export interface PasswordPolicy {
  /** Global lifetime in days; 0 means passwords never expire. */
  expiryDays: number
  roleExpiries: RolePasswordExpiry[]
  complexity: PasswordComplexity
  notifications: PasswordExpiryNotification
}

/** A role the page can attach an expiry to, with how many active users hold it. */
export interface PasswordPolicyRole {
  id: string
  name: string
  userCount: number
}

export interface PasswordPolicyCatalogDto {
  policy: PasswordPolicy
  version: number
  updatedAt: string
  /** Returned by this endpoint itself — the roles API needs a different permission than this page does. */
  roles: PasswordPolicyRole[]
}

export interface UpdatePasswordPolicyRequest {
  policy: PasswordPolicy
  /** The version this page loaded; a save based on an older one is refused (409) instead of overwriting someone else's. */
  expectedVersion?: number
}

export const passwordPolicyApi = {
  get: (accessToken: string) =>
    apiFetch<PasswordPolicyCatalogDto>(`${base}/api/password-policy`, { accessToken }),

  update: (accessToken: string, body: UpdatePasswordPolicyRequest) =>
    apiFetch<PasswordPolicyCatalogDto>(`${base}/api/password-policy`, { method: 'PUT', accessToken, body }),
}
