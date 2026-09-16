import type { DrawerLayer, SettingsTab } from '../stores/settingsDrawerStore'
import type { Icon } from '../components/Icon/Icon'

/**
 * Every section reachable from the settings gear, in the order its tabs appear.
 *
 * @remarks
 * This list used to be written out separately in four places — the gear's visibility check, the
 * drawer's tab buttons, the URL handler's permission table and the "which tab first" rule — and they
 * had drifted: the gear ignored Checker Assignment, so an operator whose only settings permission was
 * checker assignment never saw the gear at all, although the tab was built for exactly them. One
 * definition now drives all four. Adding a section means adding one entry here and its panel in
 * SettingsDrawer; the gear, tabs, URLs, permission checks and default tab follow.
 *
 * Visibility is decided by the signed-in user's capabilities for `featureKey` — the same permission
 * catalog the server enforces — so nothing here grants access, it only mirrors it.
 */
export interface SettingsSection {
  tab: SettingsTab
  label: string
  /** Permission feature whose `View` capability shows the section. */
  featureKey: string
  /** Capability required to open `/settings/<tab>/new`. */
  createCapability: string
  /**
   * `drawer` sections render a tab inside the drawer. `page` sections are real pages (the drawer tab
   * button navigates there and closes the drawer); only their create form opens in the drawer.
   */
  kind: 'drawer' | 'page'
  icon: keyof typeof Icon
  /** The form layer for `/settings/<tab>/new` (no id) or `/settings/<tab>/<id>`. Absent = no form route. */
  formLayer?: (entityId: string | undefined) => DrawerLayer
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  {
    tab: 'users',
    label: 'Users',
    featureKey: 'host.settings.users',
    createCapability: 'Create',
    kind: 'page',
    icon: 'Users',
    formLayer: (userId) => ({ type: 'user-form', userId }),
  },
  {
    tab: 'roles',
    label: 'Roles',
    featureKey: 'host.settings.roles',
    createCapability: 'Create',
    kind: 'drawer',
    icon: 'ShieldCheck',
    formLayer: (roleId) => ({ type: 'role-form', roleId }),
  },
  {
    tab: 'applications',
    label: 'Applications',
    featureKey: 'host.settings.applications',
    createCapability: 'Register',
    kind: 'drawer',
    icon: 'Grid',
    formLayer: (appId) => ({ type: 'app-form', appId }),
  },
  {
    tab: 'checker-assignment',
    label: 'Checker Assignment',
    featureKey: 'host.system.checker-assignment',
    createCapability: 'Manage',
    kind: 'drawer',
    icon: 'UserCheck',
  },
]

export type CapabilityCheck = (featureKey: string, capability?: string) => boolean

/** The sections this operator may see, in tab order. */
export function visibleSettingsSections(can: CapabilityCheck): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) => can(section.featureKey, 'View'))
}

/**
 * Where a bare `/settings` should land: the first drawer tab the operator can use, else the first page
 * section. Drawer tabs come first because a page section navigates away from the drawer.
 */
export function defaultSettingsSection(can: CapabilityCheck): SettingsSection | undefined {
  const visible = visibleSettingsSections(can)
  return visible.find((s) => s.kind === 'drawer') ?? visible[0]
}

export function findSettingsSection(tab: string | undefined): SettingsSection | undefined {
  return SETTINGS_SECTIONS.find((section) => section.tab === tab)
}

/**
 * Whether a path is shown as the drawer over the previous page rather than as a page of its own:
 * `/settings`, anything under a drawer section, and the create form of a page section
 * (`/settings/users/new`). `/settings/users` and `/settings/users/<id>` are real pages.
 */
export function isSettingsDrawerPath(pathname: string): boolean {
  if (!pathname) return false
  const [, root, tab, sub] = pathname.split('?')[0].replace(/\/+$/, '').split('/')
  if (root !== 'settings') return false
  if (!tab) return true
  const section = findSettingsSection(tab)
  if (!section) return false
  return section.kind === 'drawer' || sub === 'new'
}
