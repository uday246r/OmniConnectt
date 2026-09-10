import { create } from 'zustand'

export type SettingsTab = 'users' | 'roles' | 'applications' | 'departments' | 'general' | 'checker-assignment'

export type DrawerLayer =
  | { type: 'root'; tab?: SettingsTab }
  | { type: 'role-form'; roleId?: string; initialTab?: string }
  | { type: 'user-form'; userId?: string }
  | { type: 'app-form'; appId?: string }
  | { type: 'checker-assignment-form'; module?: string; appId?: string }

const STORAGE_KEY = 'omni_settings_return_path'

function getStoredReturnPath(): string {
  try {
    const stored = sessionStorage.getItem(STORAGE_KEY)
    if (stored && !isDrawerRoute(stored)) return stored
  } catch {}
  return '/'
}

/**
 * Routes that render the drawer rather than a page of their own.
 *
 * Everything else — including /settings/users and /settings/users/:id, which are real pages — is
 * somewhere the operator can be sent back to when the drawer closes. Used to decide what counts as
 * a return target; see `returnPath`.
 */
export function isDrawerRoute(pathname: string): boolean {
  if (!pathname) return false
  const clean = pathname.split('?')[0].replace(/\/+$/, '')
  return (
    clean === '/settings' ||
    clean === '/settings/users/new' ||
    clean.startsWith('/settings/roles') ||
    clean.startsWith('/settings/applications') ||
    clean.startsWith('/settings/checker-assignment')
  )
}

interface SettingsDrawerState {
  isOpen: boolean
  activeTab: SettingsTab
  layerStack: DrawerLayer[]
  /**
   * Where closing the drawer should land.
   *
   * Closing used to be a hard-coded `navigate('/')`, so every trip into Settings ended on the
   * dashboard no matter where it started — open the gear from a lead, close it, and you had lost
   * your place. This holds the last non-drawer route the operator was actually on; `/` is only the
   * fallback for a cold deep-link into a settings URL, where there genuinely is no "back".
   */
  returnPath: string
  open: (tab?: SettingsTab) => void
  close: () => void
  setActiveTab: (tab: SettingsTab) => void
  setReturnPath: (path: string) => void
  pushLayer: (layer: DrawerLayer) => void
  popLayer: () => void
  resetToRoot: (tab?: SettingsTab) => void
}

export const useSettingsDrawerStore = create<SettingsDrawerState>((set, get) => ({
  isOpen: false,
  activeTab: 'users',
  layerStack: [{ type: 'root', tab: 'users' }],
  returnPath: getStoredReturnPath(),


  open: (tab = 'users') => {
    set({
      isOpen: true,
      activeTab: tab,
      layerStack: [{ type: 'root', tab }],
    })
  },

  close: () => {
    set({
      isOpen: false,
      layerStack: [{ type: 'root', tab: get().activeTab }],
    })
  },

  setActiveTab: (tab) => {
    set({
      activeTab: tab,
      layerStack: [{ type: 'root', tab }],
    })
  },

  setReturnPath: (path) => {
    if (!path || isDrawerRoute(path)) return
    try {
      sessionStorage.setItem(STORAGE_KEY, path)
    } catch {}
    set({ returnPath: path })
  },

  pushLayer: (layer) => {
    set((state) => ({
      isOpen: true,
      layerStack: [...state.layerStack, layer],
    }))
  },

  popLayer: () => {
    set((state) => {
      if (state.layerStack.length <= 1) {
        return { isOpen: false, layerStack: [{ type: 'root', tab: state.activeTab }] }
      }
      const newStack = state.layerStack.slice(0, -1)
      const top = newStack[newStack.length - 1]
      const shouldClose =
        top.type === 'root' &&
        (top.tab === 'users' || (typeof window !== 'undefined' && !isDrawerRoute(window.location.pathname)))
      return {
        isOpen: !shouldClose,
        layerStack: shouldClose ? [{ type: 'root', tab: state.activeTab }] : newStack,
        activeTab: top.type === 'root' && top.tab ? top.tab : state.activeTab,
      }
    })
  },

  resetToRoot: (tab) => {
    const targetTab = tab ?? get().activeTab
    set({
      isOpen: true,
      activeTab: targetTab,
      layerStack: [{ type: 'root', tab: targetTab }],
    })
  },
}))
