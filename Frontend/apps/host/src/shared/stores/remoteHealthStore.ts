import { create } from 'zustand'
import { remoteAppsApi, type HealthEntryDto } from '../../features/settings-applications/api/remoteAppsApi'
import { registerSessionCleanup } from '../../features/auth/store/authStore'

/**
 * Reachability of the registered remote apps, polled on a timer.
 *
 * This replaces a store that also held a parallel copy of the sidebar. That copy was a second source
 * of truth for a question `GET /api/navigation` already answers — and the two could disagree, since
 * one was permission-filtered by the navigation tree's rules and the other by the registry's. The
 * only things the shell ever read from it were health and a key-to-display-name lookup, and the
 * health feed carries both.
 */
export type RemoteHealthStatus = 'idle' | 'loading' | 'loaded' | 'error'

interface RemoteHealthState {
  status: RemoteHealthStatus
  entries: HealthEntryDto[]
  /** Fetches the stored health. `forceProbe` asks the server to re-probe the remotes first. */
  fetch: (accessToken: string, forceProbe?: boolean) => Promise<void>
  /** Same, resolving a fresh token itself. What the polling timer calls. */
  refetch: (forceProbe?: boolean) => Promise<void>
  /** Wipes back to the pre-login state. Registered as a session-cleanup handler below. */
  reset: () => void
}

export const useRemoteHealthStore = create<RemoteHealthState>((set, get) => ({
  status: 'idle',
  entries: [],

  async fetch(accessToken, forceProbe = false) {
    // Only the FIRST load may show a loading state. A poll must never flip this back to 'loading',
    // which would blank a panel that is already showing perfectly good last-known values.
    if (get().status === 'idle') {
      set({ status: 'loading' })
    }

    try {
      const entries = forceProbe
        ? await remoteAppsApi.refreshHealth(accessToken)
        : await remoteAppsApi.health(accessToken)
      set({ entries, status: 'loaded' })
    } catch (err) {
      console.warn('Remote app health poll failed:', err)

      // A failed poll must never blank or error out something already on screen — leave the
      // last-known values in place and try again on the next tick.
      if (get().entries.length === 0) {
        set({ status: 'error' })
      }
    }
  },

  async refetch(forceProbe = false) {
    try {
      const { useAuthStore } = await import('../../features/auth/store/authStore')
      const token = await useAuthStore.getState().ensureFreshAccessToken()
      if (token) {
        await get().fetch(token, forceProbe)
      }
    } catch (err) {
      console.warn('Remote app health refetch failed:', err)
    }
  },

  reset: () => set({ status: 'idle', entries: [] }),
}))

// Without this, signing out and back in as someone else showed the PREVIOUS user's apps: the store
// kept status 'loaded' across the logout, and the shell only fetches from 'idle'.
registerSessionCleanup(() => useRemoteHealthStore.getState().reset())
