import { env } from '../../../config/env'
import { apiFetch } from '../../../shared/api/httpClient'

const base = env.authServiceUrl

/** Whether the deployment has bought a feature. Separate from whether a given user may use it. */
export type EntitlementStatus = 'Licensed' | 'Unlicensed' | 'Trial'

/** How an unavailable feature presents: normally, visibly locked, or absent from the sidebar. */
export type EntitlementVisibility = 'Normal' | 'Locked' | 'Hidden'

export interface EntitlementNodeDto {
  featureKey: string
  displayName: string
  isActive: boolean
  sortOrder: number
  status: EntitlementStatus
  visibility: EntitlementVisibility
  planTier: string | null
  lockReason: string | null
  expiresAt: string | null
  /** False when this row inherits from its parent rather than holding an entitlement of its own. */
  hasOwnEntitlement: boolean
  /** What actually happens after expiry and inheritance are applied — not just what is stored. */
  effectiveOutcome: 'Available' | 'Locked' | 'Hidden'
  children: EntitlementNodeDto[]
}

export interface UpdateEntitlementRequest {
  status: EntitlementStatus
  visibility: EntitlementVisibility
  planTier?: string | null
  lockReason?: string | null
  expiresAt?: string | null
}

export const entitlementsApi = {
  list: (accessToken: string, signal?: AbortSignal) =>
    apiFetch<EntitlementNodeDto[]>(`${base}/api/entitlements`, { accessToken, signal }),

  update: (accessToken: string, featureKey: string, body: UpdateEntitlementRequest, signal?: AbortSignal) =>
    apiFetch<EntitlementNodeDto>(`${base}/api/entitlements/${encodeURIComponent(featureKey)}`, {
      method: 'PUT',
      accessToken,
      body,
      signal,
    }),
}
