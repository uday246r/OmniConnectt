import { ApiError } from '../../shared/api/httpClient'

/**
 * The request that blocked a new submission, as returned in the 409's `pendingRequest`
 * ProblemDetails extension. Mirrors AuthService's PendingApprovalConflictDto.
 */
export interface PendingApprovalConflict {
  approvalRequestId: string
  module: string
  action: string
  entityLabel: string | null
  makerName: string | null
  checkerName: string | null
  requestedAt: string
  /** True when the blocked maker also raised the open request — lets the copy say "You already have…". */
  isOwnRequest: boolean
}

/**
 * Recognises the "one open request per record" refusal.
 *
 * Every gated mutation can now come back 409 because the target already has a request awaiting
 * approval — which is not an error the user did anything wrong to cause, and reads badly as a red
 * error toast. Callers use this to branch into an explanatory dialog instead.
 *
 * Deliberately shape-checked rather than status-checked: a 409 can also mean a genuine conflict
 * (duplicate email, role still in use), and those should keep their normal error handling.
 */
export function asPendingApprovalConflict(err: unknown): PendingApprovalConflict | null {
  if (!(err instanceof ApiError) || err.status !== 409) return null

  const pending = err.extensions?.pendingRequest as PendingApprovalConflict | undefined
  return pending && typeof pending.approvalRequestId === 'string' ? pending : null
}
