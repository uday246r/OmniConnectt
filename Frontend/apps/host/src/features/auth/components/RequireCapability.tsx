import type { ReactNode } from 'react'
import { Navigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { SkeletonBlock } from '../../../shared/components/Skeleton'
import styles from './RequireCapability.module.css'

export interface RequireCapabilityProps {
  featureKey: string
  capability?: string
  children: ReactNode
}

/**
 * Route-level permission gate — the settings drawer already hides tabs the user can't use, this stops
 * direct URL access too. Defensive `status === 'hydrating'` guard mirrors RequireAuth's own: in
 * today's route tree this component is always nested inside RequireAuth (which already blocks
 * rendering until hydration finishes), so `user` is never actually null by the time this evaluates
 * — but that's a composition assumption, not a guarantee. Checking it here too means a legitimate,
 * permitted page can never flash a 404 before permissions are known, even if this were ever used
 * standalone in the future.
 */
export function RequireCapability({ featureKey, capability = 'View', children }: RequireCapabilityProps) {
  const status = useAuthStore((s) => s.status)
  const allowed = useAuthStore((s) => Boolean(s.user?.isAdministrator) || s.hasCapability(featureKey, capability))

  if (status === 'idle' || status === 'hydrating') {
    return (
      <div className={styles.hydrating}>
        <SkeletonBlock height={40} width={240} />
      </div>
    )
  }

  return allowed ? <>{children}</> : <Navigate to="/404" replace />
}
