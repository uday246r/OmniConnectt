import { useEffect, useState } from 'react'
import { useAuthStore } from '../../auth/store/authStore'
import { permissionsApi, type PermissionFeatureDto } from '../../../shared/api/permissionsApi'

/**
 * The full capability catalog, used to label and group raw "featureKey:Capability" permission
 * strings into a readable table (see `PermissionMatrixTable`). Shared between the Profile page
 * (the logged-in user's own permissions) and the Users & Roles detail page (an arbitrary user's).
 */
export function usePermissionCatalog(): { catalog: PermissionFeatureDto[]; loading: boolean } {
  const accessToken = useAuthStore((s) => s.accessToken)
  // A token refresh must not re-run a load (and reset what the user is editing) — only its first arrival.
  const hasAccessToken = Boolean(accessToken)
  const [catalog, setCatalog] = useState<PermissionFeatureDto[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false
    setLoading(true)
    permissionsApi
      .catalog(accessToken)
      .then((res) => {
        if (!cancelled) setCatalog(res)
      })
      .catch(() => {
        // Silently retain empty catalog; built-in metadata dictionary will handle it
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [hasAccessToken])

  return { catalog, loading }
}
