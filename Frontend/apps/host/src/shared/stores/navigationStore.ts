import { create } from 'zustand'
import {
  navigationApi,
  findAppNode,
  findNodeByRoute,
  type NavNodeDto,
  type NavSectionDto,
} from '../api/navigationApi'
import { registerSessionCleanup, useAuthStore } from '../../features/auth/store/authStore'

export type NavigationStatus = 'idle' | 'loading' | 'loaded' | 'error'

const EXPANDED_STORAGE_KEY = 'omni.sidebar.expanded'

interface NavigationState {
  status: NavigationStatus
  sections: NavSectionDto[]
  error: string | null

  /**
   * Which app rows are expanded. Host state, deliberately — the chevron and the open/closed state
   * are the host's to own now, where before each remote kept its own useState and the host forwarded
   * synthetic clicks to a button the remote had appended into the host's own anchor.
   */
  expanded: Set<string>

  /** When the tree was last read successfully (ms since epoch); 0 before the first read. */
  fetchedAt: number

  fetch: (accessToken: string, signal?: AbortSignal) => Promise<void>
  /**
   * Re-reads the tree with the current session's token, if there is one. Called when the server says
   * the tree changed (a release promoted, an app put into maintenance) and when the tab comes back
   * into view, so a long-open tab does not keep mounting a build that is no longer live.
   */
  refresh: () => Promise<void>
  toggleExpanded: (key: string) => void
  setExpanded: (key: string, open: boolean) => void
  findByRoute: (routePath: string) => NavNodeDto | undefined
  findApp: (appKey: string) => NavNodeDto | undefined
  reset: () => void
}

/**
 * Reading localStorage can throw outright in a private window or with site data blocked, so a
 * failure has to degrade to "nothing remembered" rather than taking the sidebar down with it.
 */
function loadExpanded(): Set<string> {
  try {
    const raw = localStorage.getItem(EXPANDED_STORAGE_KEY)
    return raw ? new Set(JSON.parse(raw) as string[]) : new Set()
  } catch {
    return new Set()
  }
}

function persistExpanded(expanded: Set<string>) {
  try {
    localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify([...expanded]))
  } catch {
    // A remembered expand state is a convenience, never worth an error.
  }
}

export const useNavigationStore = create<NavigationState>((set, get) => ({
  status: 'idle',
  sections: [],
  error: null,
  fetchedAt: 0,
  expanded: loadExpanded(),

  async fetch(accessToken, signal) {
    // Only the first load shows a loading state. Settings screens refetch the tree after registering
    // or editing an app; flipping back to 'loading' then made RemoteAppPage swap the mounted remote
    // for a skeleton — unmounting it and discarding whatever the user had open or half-typed.
    if (get().sections.length === 0) set({ status: 'loading', error: null })
    try {
      const tree = await navigationApi.get(accessToken, signal)
      set({ sections: tree.sections, status: 'loaded', error: null, fetchedAt: Date.now() })
    } catch (err) {
      // Keep whatever was already rendered rather than blanking the sidebar on a transient failure —
      // an empty sidebar reads as "you have lost all your access", which is far more alarming than
      // a slightly stale one.
      if (get().sections.length > 0) {
        set({ status: 'loaded', error: null })
        return
      }
      console.warn('Navigation fetch failed:', err)
      set({ status: 'error', error: 'Could not load navigation. Try refreshing the page.' })
    }
  },

  async refresh() {
    const token = useAuthStore.getState().accessToken
    if (!token || get().status === 'idle') return
    await get().fetch(token)
  },

  toggleExpanded(key) {
    const next = new Set(get().expanded)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    persistExpanded(next)
    set({ expanded: next })
  },

  setExpanded(key, open) {
    // The sidebar calls this on every navigation. When the row is already in the requested state it
    // must not write storage or publish a new Set — that re-rendered every sidebar row each time.
    if (get().expanded.has(key) === open) return
    const next = new Set(get().expanded)
    if (open) next.add(key)
    else next.delete(key)
    persistExpanded(next)
    set({ expanded: next })
  },

  findByRoute: (routePath) => findNodeByRoute(get().sections, routePath),
  findApp: (appKey) => findAppNode(get().sections, appKey),

  reset: () => set({ status: 'idle', sections: [], error: null, fetchedAt: 0 }),
}))

/** A tab returning to view after this long re-reads the tree; the server push covers the common case. */
const STALE_ON_RETURN_MS = 60_000

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    const { status, fetchedAt, refresh } = useNavigationStore.getState()
    if (document.visibilityState === 'visible' && status === 'loaded' && Date.now() - fetchedAt > STALE_ON_RETURN_MS) {
      void refresh()
    }
  })
}

// The tree is filtered per user, so it must not survive into the next session.
registerSessionCleanup(() => useNavigationStore.getState().reset())
