import { create } from 'zustand'
import { moduleRegistryClient, type SidebarAppDto } from '../api/moduleRegistryClient'
import { registerSessionCleanup } from '../../features/auth/store/authStore'

export type ModuleRegistryStatus = 'idle' | 'loading' | 'loaded' | 'error'

interface ModuleRegistryState {
  status: ModuleRegistryStatus
  apps: SidebarAppDto[]
  error: string | null
  fetchForSidebar: (accessToken: string) => Promise<void>
  refetch: () => Promise<void>
  /** Merges fresh health/lastHealthCheckAt into the existing apps array by key — never touches
   * `status`, never re-fetches the full app list. Safe to call on a timer: unlike fetchForSidebar,
   * this can't flip `status` back to 'loading' and blank the sidebar or a mounted RemoteAppPage. */
  refreshHealth: (accessToken: string, forceProbe?: boolean) => Promise<void>
  /** `forceProbe` asks the registry to probe the remotes now instead of returning its last sweep. */
  refetchHealth: (forceProbe?: boolean) => Promise<void>
  getApp: (key: string) => SidebarAppDto | undefined
  /** Wipes cached apps back to the pre-login state. Registered as a session-cleanup handler below. */
  reset: () => void
}

export const useModuleRegistryStore = create<ModuleRegistryState>((set, get) => ({
  status: 'idle',
  apps: [],
  error: null,

  async fetchForSidebar(accessToken) {
    set({ status: 'loading', error: null })
    try {
      const apps = await moduleRegistryClient.forSidebar(accessToken)
      set({ apps, status: 'loaded', error: null })
    } catch (err: unknown) {
      console.warn('ModuleRegistry fetchForSidebar failed:', err)
      // If we already had cached apps, retain them rather than showing a blank broken state
      if (get().apps.length > 0) {
        set({ status: 'loaded', error: null })
      } else {
        set({ status: 'error', error: 'Could not load apps. Try refreshing the page.' })
      }
    }
  },

  async refetch() {
    try {
      const { useAuthStore } = await import('../../features/auth/store/authStore')
      const token = await useAuthStore.getState().ensureFreshAccessToken()
      if (token) {
        await get().fetchForSidebar(token)
      }
    } catch (err) {
      console.warn('ModuleRegistry refetch failed:', err)
    }
  },

  async refreshHealth(accessToken, forceProbe = false) {
    const { apps, status } = get()
    if (status !== 'loaded' || apps.length === 0) return
    try {
      // Same merge either way — only where the numbers come from differs. The forced call makes the
      // registry re-probe rather than hand back what its background sweep last stored, which is what
      // makes arriving on a page reflect reality instead of a value up to a sweep interval old.
      const entries = forceProbe
        ? await moduleRegistryClient.refreshHealth(accessToken)
        : await moduleRegistryClient.health(accessToken)
      const byKey = new Map(entries.map((e) => [e.key, e]))
      set({
        apps: get().apps.map((app) => {
          const entry = byKey.get(app.key)
          return entry ? { ...app, health: entry.health, lastHealthCheckAt: entry.lastCheckedAt } : app
        }),
      })
    } catch (err) {
      // A failed poll must never blank or error out a sidebar that's already showing something —
      // just leave the last-known health in place and try again next tick.
      console.warn('ModuleRegistry refreshHealth failed:', err)
    }
  },

  async refetchHealth(forceProbe = false) {
    try {
      const { useAuthStore } = await import('../../features/auth/store/authStore')
      const token = await useAuthStore.getState().ensureFreshAccessToken()
      if (token) {
        await get().refreshHealth(token, forceProbe)
      }
    } catch (err) {
      console.warn('ModuleRegistry refetchHealth failed:', err)
    }
  },

  getApp: (key) => get().apps.find((app) => app.key === key),

  reset: () => set({ status: 'idle', apps: [], error: null }),
}))

// Without this, signing out and signing in as someone else showed the PREVIOUS user's sidebar:
// this store kept status 'loaded' across the logout, and App.tsx only fetches when status is
// 'idle', so it never refetched for the new user.
registerSessionCleanup(() => useModuleRegistryStore.getState().reset())
