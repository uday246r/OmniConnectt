import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore, isSuperAdminOrAdmin } from '../store/authStore'
import { SkeletonBlock } from '../../../shared/components/Skeleton'
import styles from './RequireCapability.module.css'

export interface RequireCapabilityProps {
  featureKey: string
  capability?: string
  children: ReactNode
}

/**
 * Route-level permission gate — the settings drawer and the sidebar already hide what the user cannot
 * use; this stops direct URL access too.
 *
 * A denial sends the caller to the dashboard rather than rendering an error. Landing on a 404 after
 * following an old bookmark or a link from a colleague reads as "the application is broken", when
 * what has actually happened is that this account does not have that section — and there is nothing
 * for the user to do about it on that page. The dashboard is somewhere they can act.
 *
 * The trade-off, stated plainly: a redirect distinguishes "you may not open this" from "no such
 * page", which the previous 404 deliberately did not. Non-disclosure still holds where it matters —
 * the navigation tree is built server-side and simply omits what the caller may not reach
 * (NavigationTreeBuilder), so nothing here advertises a section's existence to someone who was not
 * already guessing its URL.
 *
 * An unauthenticated visitor never reaches this component; RequireAuth sends them to the login page
 * first.
 */
export function RequireCapability({ featureKey, capability = 'View', children }: RequireCapabilityProps) {
  const status = useAuthStore((s) => s.status)
  const allowed = useAuthStore((s) => isSuperAdminOrAdmin(s.user) || s.hasCapability(featureKey, capability))

  if (status === 'idle' || status === 'hydrating') {
    return (
      <div className={styles.hydrating}>
        <SkeletonBlock height={40} width={240} />
      </div>
    )
  }

  return allowed ? <>{children}</> : <Navigate to="/" replace />
}
