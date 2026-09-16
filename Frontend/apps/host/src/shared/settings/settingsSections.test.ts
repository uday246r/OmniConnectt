import { describe, expect, it } from 'vitest'
import {
  SETTINGS_SECTIONS,
  defaultSettingsSection,
  findSettingsSection,
  isSettingsDrawerPath,
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
    ['/settings', true],
    ['/settings/', true],
    ['/settings/roles', true],
    ['/settings/roles/r-1', true],
    ['/settings/applications/new', true],
    ['/settings/checker-assignment', true],
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
    expect(isSettingsDrawerPath('/settings/roles?from=search')).toBe(true)
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

  it('lands a bare /settings on a drawer tab before a page section', () => {
    const usersAndApplications = grants('host.settings.users:View', 'host.settings.applications:View')

    expect(defaultSettingsSection(usersAndApplications)?.tab).toBe('applications')
    expect(defaultSettingsSection(grants('host.settings.users:View'))?.tab).toBe('users')
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
