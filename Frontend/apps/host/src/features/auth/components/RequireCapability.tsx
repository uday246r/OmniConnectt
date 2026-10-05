import type { ReactNode } from 'react'
import { useAuthStore, isSuperAdminOrAdmin } from '../store/authStore'
import { SkeletonBlock } from '../../../shared/components/Skeleton'
import { NotFoundPage } from '../../../pages/NotFoundPage/NotFoundPage'
import styles from './RequireCapability.module.css'

export interface RequireCapabilityProps {
  featureKey: string
  capability?: string
  children: ReactNode
}

/**
 * Route-level permission gate — the settings drawer already hides tabs the user can't use, this stops
 * direct URL access too. Returns 404 (NotFoundPage) on access denial so unauthorized users cannot
 * infer the existence of protected pages or modules.
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

  return allowed ? <>{children}</> : <NotFoundPage />
}
