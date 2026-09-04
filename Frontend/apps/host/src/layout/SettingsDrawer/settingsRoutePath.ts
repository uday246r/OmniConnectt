import type { DrawerLayer, SettingsTab } from '../../shared/stores/settingsDrawerStore'

/**
 * The two-way mapping between the settings drawer's state and a `/settings/...` URL.
 *
 * The drawer used to be pure local state: opening it, switching tabs and opening a form all left the
 * URL untouched, and the `/settings/*` routes that did exist immediately bounced back to `/`. So the
 * address bar said "dashboard" while the screen showed the role editor — nothing about the drawer
 * could be refreshed, linked, bookmarked or reached with Back.
 *
 * Kept as pure functions so both directions read off one table and cannot drift apart.
 */

/** Tabs that own a URL. `general`/`departments` have no routed screen, so they fall back to Users. */
const ROUTED_TABS = ['users', 'roles', 'applications', 'checker-assignment'] as const

export type RoutedSettingsTab = (typeof ROUTED_TABS)[number]

export function isRoutedTab(tab: string): tab is RoutedSettingsTab {
  return (ROUTED_TABS as readonly string[]).includes(tab)
}

/** The URL a given drawer state should be showing. */
export function settingsPathFor(tab: SettingsTab, layerStack: DrawerLayer[]): string {
  const top = layerStack[layerStack.length - 1]
  const base = isRoutedTab(tab) ? tab : 'users'

  switch (top?.type) {
    case 'user-form':
      return top.userId ? `/settings/users/${top.userId}` : '/settings/users/new'
    case 'role-form':
      return top.roleId ? `/settings/roles/${top.roleId}` : '/settings/roles/new'
    case 'app-form':
      return top.appId ? `/settings/applications/${top.appId}` : '/settings/applications/new'
    case 'checker-assignment-form':
      return '/settings/checker-assignment/new'
    default:
      return `/settings/${base}`
  }
}

export interface SettingsUrlState {
  tab: RoutedSettingsTab
  /** The form layer this URL asks for, if any. `undefined` means "just the tab". */
  layer?: DrawerLayer
}

/** What drawer state a `/settings/...` URL is asking for, or null if it is not a settings URL. */
export function settingsStateFor(pathname: string): SettingsUrlState | null {
  const match = /^\/settings(?:\/([^/]+))?(?:\/([^/]+))?\/?$/.exec(pathname)
  if (!match) return null

  const rawTab = match[1] ?? 'users'
  if (!isRoutedTab(rawTab)) return null

  const entity = match[2]
  if (!entity) return { tab: rawTab }

  const id = entity === 'new' ? undefined : entity

  switch (rawTab) {
    case 'users':
      return { tab: rawTab, layer: { type: 'user-form', userId: id } }
    case 'roles':
      return { tab: rawTab, layer: { type: 'role-form', roleId: id } }
    case 'applications':
      return { tab: rawTab, layer: { type: 'app-form', appId: id } }
    case 'checker-assignment':
      // Only the create form is addressable — a checker assignment is identified by its module, and
      // that is chosen inside the form rather than carried in the URL.
      return { tab: rawTab, layer: { type: 'checker-assignment-form' } }
  }
}

/** True when two layers address the same thing, so an already-open form is not re-pushed. */
export function isSameLayer(a: DrawerLayer | undefined, b: DrawerLayer | undefined): boolean {
  if (!a || !b) return a === b
  if (a.type !== b.type) return false
  switch (a.type) {
    case 'user-form':
      return a.userId === (b as typeof a).userId
    case 'role-form':
      return a.roleId === (b as typeof a).roleId
    case 'app-form':
      return a.appId === (b as typeof a).appId
    default:
      return true
  }
}
