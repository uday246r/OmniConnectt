import type { ReactNode } from 'react'
import { useAuthStore, isSuperAdminOrAdmin } from '../../../features/auth/store/authStore'

export interface PermissionGateProps {
  featureKey: string
  capability: string
  children: ReactNode
  /** Rendered instead of children when the capability is missing. Omit to render nothing. */
  fallback?: ReactNode
}

/**
 * Inline action-level permission gate — wraps a button/control that should only ever render for
 * users who actually hold the given capability. Administrators always pass, same short-circuit
 * `hasCapability` already applies everywhere else. Prefer this over hand-rolling
 * `const canX = hasCapability(...)` for new UI so every gate reads the same way; existing pages that
 * already compute their own capability consts are left as-is, not forced onto this component.
 */
export function PermissionGate({ featureKey, capability, children, fallback = null }: PermissionGateProps) {
  const allowed = useAuthStore((s) => isSuperAdminOrAdmin(s.user) || s.hasCapability(featureKey, capability))
  return allowed ? <>{children}</> : <>{fallback}</>
}
