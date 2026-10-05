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
export type SettingsCategory = 'ACCESS MANAGEMENT' | 'CONFIGURATION' | 'GOVERNANCE'

export interface SettingsSection {
  tab: SettingsTab
  label: string
  category: SettingsCategory
  /** Permission feature whose `View` capability shows the section. */
  featureKey: string
  /** Capability required to open `/settings/<tab>/new` or perform creation. */
  createCapability?: string
  /**
   * `drawer` sections render a tab inside the drawer. `page` sections are real pages (the drawer tab
   * button navigates there and closes the drawer); only their create form opens in the drawer.
   */
  kind: 'drawer' | 'page'
  icon?: keyof typeof Icon
  /** Absolute route path for navigation. */
  routePath: string
  /** The form layer for `/settings/<tab>/new` (no id) or `/settings/<tab>/<id>`. Absent = no form route. */
  formLayer?: (entityId: string | undefined) => DrawerLayer
}

export const SETTINGS_SECTIONS: readonly SettingsSection[] = [
  // ── ACCESS MANAGEMENT ─────────────────────────────────────────
  {
    tab: 'users',
    label: 'Users',
    category: 'ACCESS MANAGEMENT',
    featureKey: 'host.settings.users',
    createCapability: 'Create',
    kind: 'page',
    icon: 'Users',
    routePath: '/settings/users',
    formLayer: (userId) => ({ type: 'user-form', userId }),
  },
  {
    tab: 'roles',
    label: 'Roles & Permissions',
    category: 'ACCESS MANAGEMENT',
    featureKey: 'host.settings.roles',
    createCapability: 'Create',
    kind: 'page',
    icon: 'ShieldCheck',
    routePath: '/settings/roles',
    formLayer: (roleId) => ({ type: 'role-form', roleId }),
  },
  {
    tab: 'applications',
    label: 'Applications',
    category: 'ACCESS MANAGEMENT',
    featureKey: 'host.settings.applications',
    createCapability: 'Register',
    kind: 'page',
    icon: 'Grid',
    routePath: '/settings/applications',
    formLayer: (appId) => ({ type: 'app-form', appId }),
  },
  {
    tab: 'checker-assignment',
    label: 'Checker Assignment',
    category: 'ACCESS MANAGEMENT',
    featureKey: 'host.system.checker-assignment',
    createCapability: 'Manage',
    kind: 'page',
    icon: 'UserCheck',
    routePath: '/settings/checker-assignment',
    formLayer: (module) => ({ type: 'checker-assignment-form', module }),
  },

  // ── CONFIGURATION ────────────────────────────────────────────
  {
    tab: 'fields',
    label: 'Manage Fields',
    category: 'CONFIGURATION',
    featureKey: 'host.settings.users',
    createCapability: 'Edit',
    kind: 'page',
    icon: 'FileText',
    routePath: '/settings/fields',
  },
  {
    tab: 'formats',
    label: 'Manage Formats',
    category: 'CONFIGURATION',
    featureKey: 'host.settings.users',
    createCapability: 'Edit',
    kind: 'page',
    icon: 'Key',
    routePath: '/settings/formats',
  },
  {
    tab: 'password-policy',
    label: 'Manage Password Policy',
    category: 'CONFIGURATION',
    // Its own feature, not Settings > Users: whoever shapes the user form is not necessarily who should
    // decide how long a credential lives.
    featureKey: 'host.settings.password-policy',
    createCapability: 'Edit',
    kind: 'page',
    icon: 'Lock',
    routePath: '/settings/password-policy',
  },

  // ── GOVERNANCE ───────────────────────────────────────────────
  {
    tab: 'approvals',
    label: 'Approval Center',
    category: 'GOVERNANCE',
    featureKey: 'host.system.approvals',
    createCapability: 'Approve',
    kind: 'page',
    icon: 'UserCheck',
    routePath: '/system/approvals',
  },
  {
    tab: 'audit-logs',
    label: 'Audit Logs',
    category: 'GOVERNANCE',
    featureKey: 'host.system.audit-logs',
    kind: 'page',
    icon: 'FileText',
    routePath: '/system/audit-logs',
  },
  {
    tab: 'system-logs',
    label: 'System Logs',
    category: 'GOVERNANCE',
    featureKey: 'host.system.system-logs',
    kind: 'page',
    icon: 'Terminal',
    routePath: '/system/system-logs',
  },
]

export type CapabilityCheck = (featureKey: string, capability?: string) => boolean

/** The sections this operator may see, in order. */
export function visibleSettingsSections(can: CapabilityCheck): SettingsSection[] {
  return SETTINGS_SECTIONS.filter((section) => can(section.featureKey, 'View'))
}

export interface SettingsGroup {
  category: SettingsCategory
  items: SettingsSection[]
}

const SETTINGS_CATEGORIES: readonly SettingsCategory[] = [
  'ACCESS MANAGEMENT',
  'CONFIGURATION',
  'GOVERNANCE',
]

/** Groups visible settings sections by category, omitting empty categories. */
export function visibleSettingsGroups(can: CapabilityCheck): SettingsGroup[] {
  const visible = visibleSettingsSections(can)
  const groups: SettingsGroup[] = []

  for (const category of SETTINGS_CATEGORIES) {
    const items = visible.filter((item) => item.category === category)
    if (items.length > 0) {
      groups.push({ category, items })
    }
  }

  return groups
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
 * sub-routes with a formLayer (e.g. `/settings/users/new`, `/settings/roles/new`, `/settings/applications/new`),
 * or sections with kind 'drawer'. Standalone pages (`/settings/users`, `/settings/roles`, `/settings/applications`,
 * `/settings/fields`, `/system/approvals`) return false.
 */
export function isSettingsDrawerPath(pathname: string): boolean {
  if (!pathname) return false
  const [, root, tab, sub] = pathname.split('?')[0].replace(/\/+$/, '').split('/')
  if (root !== 'settings') return false
  if (!tab) return false
  const section = findSettingsSection(tab)
  if (!section) return false
  if (section.kind === 'drawer') return true
  if (section.tab === 'users') return sub === 'new'
  return Boolean(sub && section.formLayer)
}

