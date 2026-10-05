import { describe, expect, it } from 'vitest'
import {
  SETTINGS_SECTIONS,
  defaultSettingsSection,
  findSettingsSection,
  isSettingsDrawerPath,
  visibleSettingsGroups,
  visibleSettingsSections,
  type CapabilityCheck,
} from './settingsSections'

/**
 * The one list of settings sections.
 *
 * The gear, the drawer's tabs, the URL handler and the default tab each used to carry their own copy
 * of this list, and they disagreed — the gear ignored Checker Assignment, so a user whose only settings
 * permission was checker assignment had no way in. These tests hold the shared rules: what is a drawer
 * URL, who sees which section, and where a bare /settings lands.
 */

const grants = (...keys: string[]): CapabilityCheck => (featureKey, capability = 'View') => keys.includes(`${featureKey}:${capability}`)

describe('isSettingsDrawerPath', () => {
  it.each([
    ['/settings', false],
    ['/settings/', false],
    ['/settings/roles', false],
    ['/settings/roles/r-1', true],
    ['/settings/roles/new', true],
    ['/settings/applications', false],
    ['/settings/applications/new', true],
    ['/settings/checker-assignment', false],
    ['/settings/users/new', true],
    ['/settings/users', false],
    ['/settings/users/42', false],
    ['/settings/fields', false],
    ['/settings/unknown', false],
    ['/apps/products/dashboard', false],
    ['/', false],
    ['', false],
  ])('%s → %s', (path, expected) => {
    expect(isSettingsDrawerPath(path)).toBe(expected)
  })

  it('ignores a query string', () => {
    expect(isSettingsDrawerPath('/settings/roles/new?from=search')).toBe(true)
    expect(isSettingsDrawerPath('/settings/roles?from=search')).toBe(false)
  })
})

describe('who sees which section', () => {
  it('shows every section to someone with every View capability, in tab order', () => {
    const all = grants(...SETTINGS_SECTIONS.map((s) => `${s.featureKey}:View`))

    expect(visibleSettingsSections(all).map((s) => s.tab)).toEqual(SETTINGS_SECTIONS.map((s) => s.tab))
  })

  it('gives someone with only checker-assignment access a way into Settings', () => {
    const visible = visibleSettingsSections(grants('host.system.checker-assignment:View'))

    expect(visible.map((s) => s.tab)).toEqual(['checker-assignment'])
    expect(defaultSettingsSection(grants('host.system.checker-assignment:View'))?.tab).toBe('checker-assignment')
  })

  it('shows nothing to someone with no settings permission', () => {
    expect(visibleSettingsSections(grants('host.dashboard:View'))).toEqual([])
    expect(defaultSettingsSection(grants('host.dashboard:View'))).toBeUndefined()
  })

  it('lands a bare /settings on the first visible page section', () => {
    const usersAndApplications = grants('host.settings.users:View', 'host.settings.applications:View')

    expect(defaultSettingsSection(usersAndApplications)?.tab).toBe('users')
    expect(defaultSettingsSection(grants('host.settings.applications:View'))?.tab).toBe('applications')
  })
})

describe('section definitions', () => {
  it('have unique tabs and a form layer that carries the record id', () => {
    const tabs = SETTINGS_SECTIONS.map((s) => s.tab)
    expect(new Set(tabs).size).toBe(tabs.length)

    expect(findSettingsSection('roles')?.formLayer?.('r-9')).toEqual({ type: 'role-form', roleId: 'r-9' })
    expect(findSettingsSection('applications')?.formLayer?.(undefined)).toEqual({ type: 'app-form', appId: undefined })
    expect(findSettingsSection('nope')).toBeUndefined()
  })
})

describe('visibleSettingsGroups', () => {
  it('groups visible sections into ACCESS MANAGEMENT, CONFIGURATION, and GOVERNANCE', () => {
    const all = grants(...SETTINGS_SECTIONS.map((s) => `${s.featureKey}:View`))
    const groups = visibleSettingsGroups(all)

    expect(groups.map((g) => g.category)).toEqual([
      'ACCESS MANAGEMENT',
      'CONFIGURATION',
      'GOVERNANCE',
    ])

    const accessGroup = groups.find((g) => g.category === 'ACCESS MANAGEMENT')
    expect(accessGroup?.items.map((i) => i.label)).toEqual([
      'Users',
      'Roles & Permissions',
      'Applications',
      'Checker Assignment',
    ])

    const configGroup = groups.find((g) => g.category === 'CONFIGURATION')
    expect(configGroup?.items.map((i) => i.label)).toEqual([
      'Manage Fields',
      'Manage Formats',
      'Manage Password Policy',
    ])

    const govGroup = groups.find((g) => g.category === 'GOVERNANCE')
    expect(govGroup?.items.map((i) => i.label)).toEqual([
      'Approval Center',
      'Audit Logs',
      'System Logs',
    ])
  })

  it('omits categories that have no visible items for a restricted role', () => {
    // Only has audit-logs View permission
    const auditOnly = grants('host.system.audit-logs:View')
    const groups = visibleSettingsGroups(auditOnly)

    expect(groups.map((g) => g.category)).toEqual(['GOVERNANCE'])
    expect(groups[0].items.map((i) => i.label)).toEqual(['Audit Logs'])
  })
})

describe('Manage Password Policy', () => {
  it('is gated by its own feature, so user-form administrators do not automatically see it', () => {
    const usersOnly = grants('host.settings.users:View')

    expect(visibleSettingsSections(usersOnly).map((s) => s.tab)).not.toContain('password-policy')
    expect(visibleSettingsSections(grants('host.settings.password-policy:View')).map((s) => s.tab)).toEqual(['password-policy'])
  })

  it('is its own page under CONFIGURATION, not a tab of Manage Fields', () => {
    const section = findSettingsSection('password-policy')

    expect(section).toMatchObject({
      label: 'Manage Password Policy',
      category: 'CONFIGURATION',
      kind: 'page',
      routePath: '/settings/password-policy',
      featureKey: 'host.settings.password-policy',
    })
  })
})
