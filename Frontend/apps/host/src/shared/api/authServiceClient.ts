import type { PasswordPolicy } from '@omniremit/ui/validation'
import { env } from '../../config/env'
import { apiFetch } from './httpClient'

const base = env.authServiceUrl

export type AuthProvider = 'Local' | 'Google'

export interface CurrentUserDto {
  id: string
  salutation: string | null
  name: string
  email: string
  phoneNumber: string | null
  roleId: string | null
  roleName: string | null
  isAdministrator: boolean
  mustChangePassword: boolean
  permissions: string[]
  authProvider: AuthProvider
  isActive: boolean
  lastLoginAt: string | null
}

export interface LoginResponse {
  accessToken: string
  expiresAt: string
  user: CurrentUserDto
}

export type RefreshResponse = LoginResponse

export interface SsoConfigDto {
  googleEnabled: boolean
  allowedDomains: string[]
  /** Google OAuth Client ID. Public by design — Google Identity Services requires it in the page. */
  clientId: string
}

export interface ValidateInviteResponse {
  valid: boolean
  /** Returned only for a valid invite, so the recipient can confirm which account they are setting up. */
  email: string | null
}

/** Raw calls against AuthService's /api/auth/* surface. No token/refresh orchestration here — see features/auth/store/authStore.ts for that. */
export const authServiceClient = {
  login: (email: string, password: string) =>
    apiFetch<LoginResponse>(`${base}/api/auth/login`, { method: 'POST', body: { email, password } }),

  loginWithGoogle: (idToken: string) =>
    apiFetch<LoginResponse>(`${base}/api/auth/google`, { method: 'POST', body: { idToken } }),

  ssoConfig: () => apiFetch<SsoConfigDto>(`${base}/api/auth/sso-config`),

  /**
   * The live password policy. Fetched rather than hardcoded so the UI enforces whatever the server is
   * actually configured with — an administrator changing the policy changes the form without a
   * rebuild, and the two can never drift apart.
   */
  passwordPolicy: (accessToken: string) =>
    apiFetch<PasswordPolicy>(`${base}/api/auth/password-policy`, { accessToken }),

  /** Checks a set-password invite before showing the form, so a dead link says so up front. */
  validateInvite: (token: string) =>
    apiFetch<ValidateInviteResponse>(
      `${base}/api/auth/set-password/validate?token=${encodeURIComponent(token)}`,
    ),

  setPassword: (token: string, newPassword: string) =>
    apiFetch<void>(`${base}/api/auth/set-password`, { method: 'POST', body: { token, newPassword } }),

  refresh: () => apiFetch<RefreshResponse>(`${base}/api/auth/refresh`, { method: 'POST' }),

  logout: () => apiFetch<void>(`${base}/api/auth/logout`, { method: 'POST' }),

  me: (accessToken: string) => apiFetch<CurrentUserDto>(`${base}/api/auth/me`, { accessToken }),

  /**
   * The caller's capabilities that are deliberately not in the access token — widgets, charts,
   * exports, panels.
   *
   * They are split off because a token carrying every one of them would grow past what Kestrel and
   * most proxies accept once each app declares its own; API capabilities, which the authorization
   * filters read from the claim, stay exactly where they are. This is for rendering only — each of
   * these is separately enforced server-side.
   */
  fineCapabilities: (accessToken: string) =>
    apiFetch<{ capabilities: string[] }>(`${base}/api/me/capabilities`, { accessToken }).then(
      (r) => r.capabilities,
    ),

  changePassword: (accessToken: string, body: { currentPassword: string; newPassword: string }) =>
    apiFetch<{ message: string }>(`${base}/api/auth/change-password`, { method: 'POST', accessToken, body }),
}
