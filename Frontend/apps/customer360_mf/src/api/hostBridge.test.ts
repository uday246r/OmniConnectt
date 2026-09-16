import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canExportAuditLogs,
  canManageFieldSettings,
  canSeeProfilePanel,
  canViewAuditLogs,
  canViewInteractions,
  canViewProducts,
  canViewProfile,
  getAccessToken,
  getCurrentUser,
  hasCapability,
  isRunningInHost,
  type OmniConnectHostBridge,
} from './hostBridge'

/**
 * How this remote decides what to show, which is entirely a question of what it asks the host.
 *
 * The subtle part is that not every helper asks the same question. The module-level ones accept the
 * parent feature key as sufficient; the panel and export ones deliberately do not. That asymmetry is
 * load-bearing and invisible from the call sites, so it is what most of this file is about.
 */

function installBridge(over: Partial<OmniConnectHostBridge> = {}) {
  const bridge: OmniConnectHostBridge = {
    getAccessToken: () => 'token',
    ensureFreshAccessToken: () => Promise.resolve('token'),
    hasCapability: () => false,
    getUser: () => ({
      id: 'u1',
      name: 'Tester',
      email: 'tester@example.com',
      isAdministrator: false,
      roleName: null,
      permissions: [],
    }),
    ...over,
  }
  window.__omniconnectHost__ = bridge
  return bridge
}

/** A bridge that grants exactly the listed `featureKey:capability` pairs. */
function bridgeGranting(...granted: string[]) {
  return installBridge({
    hasCapability: (featureKey, capability) => granted.includes(`${featureKey}:${capability}`),
  })
}

beforeEach(() => {
  delete window.__omniconnectHost__
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('running outside the host', () => {
  it('reports that it is not in the host', () => {
    expect(isRunningInHost()).toBe(false)
  })

  it('grants everything, so the remote can be previewed standalone', () => {
    /*
     * Deliberate, and worth pinning precisely because it looks like a security hole. This remote is
     * built to run inside the host shell; loaded on its own there is no bridge to ask, and refusing
     * everything would render an empty page that looks broken. Nothing is protected by this answer —
     * every capability is separately enforced by Customer360Service, which is what actually holds the
     * data. If that ever stops being true, this line is the first thing to revisit.
     */
    expect(hasCapability('remote.customer360.profile', 'View')).toBe(true)
    expect(canSeeProfilePanel('panel.contacts')).toBe(true)
  })

  it('has no token and no user', () => {
    expect(getAccessToken()).toBeNull()
    expect(getCurrentUser()).toBeNull()
  })
})

describe('running inside the host', () => {
  it('defers to the host for a capability it was not granted', () => {
    bridgeGranting()

    expect(hasCapability('remote.customer360.profile', 'View')).toBe(false)
  })

  it('passes the feature key and capability through unchanged', () => {
    const bridge = bridgeGranting('remote.customer360.profile:View')
    const spy = vi.spyOn(bridge, 'hasCapability')

    hasCapability('remote.customer360.profile', 'View')

    expect(spy).toHaveBeenCalledWith('remote.customer360.profile', 'View')
  })

  it('grants everything to an administrator without asking', () => {
    const bridge = installBridge({
      hasCapability: () => false,
      getUser: () => ({
        id: 'u1',
        name: 'Admin',
        email: 'admin@example.com',
        isAdministrator: true,
        roleName: null,
        permissions: [],
      }),
    })
    const spy = vi.spyOn(bridge, 'hasCapability')

    expect(hasCapability('anything', 'at-all')).toBe(true)
    expect(spy).not.toHaveBeenCalled()
  })
})

describe('module-level helpers accept the parent key', () => {
  // Being allowed into the app is a reasonable answer to "may this user read customers at all",
  // which is what these helpers ask.
  it.each([
    ['canViewProfile', canViewProfile],
    ['canViewProducts', canViewProducts],
    ['canViewInteractions', canViewInteractions],
    ['canViewAuditLogs', canViewAuditLogs],
    ['canManageFieldSettings', canManageFieldSettings],
  ])('%s falls back to the app-level View', (_name, helper) => {
    bridgeGranting('remote.customer360:View')

    expect(helper()).toBe(true)
  })
})

describe('panel and export helpers do not', () => {
  it('a panel is not implied by being allowed into the app', () => {
    /*
     * The asymmetry, stated as plainly as it can be.
     *
     * If `canSeeProfilePanel` fell back to `remote.customer360:View` like the helpers above, then
     * everyone who could open the app would see every panel — and the per-panel grant would exist in
     * the editor, be tickable, be stored, and mean absolutely nothing.
     */
    bridgeGranting('remote.customer360:View')

    expect(canSeeProfilePanel('panel.contacts')).toBe(false)
    expect(canSeeProfilePanel('panel.interactions')).toBe(false)
    expect(canSeeProfilePanel('panel.products')).toBe(false)
  })

  it('nor is the audit export implied by being able to read the audit log', () => {
    bridgeGranting('remote.customer360.audit:View', 'remote.customer360:View')

    expect(canViewAuditLogs()).toBe(true)
    expect(canExportAuditLogs()).toBe(false)
  })

  it('a granted panel is allowed, and only that one', () => {
    bridgeGranting('remote.customer360.profile:panel.interactions')

    expect(canSeeProfilePanel('panel.interactions')).toBe(true)
    expect(canSeeProfilePanel('panel.contacts')).toBe(false)
    expect(canSeeProfilePanel('panel.products')).toBe(false)
  })

  it('a granted export is allowed', () => {
    bridgeGranting('remote.customer360.audit:export.csv')

    expect(canExportAuditLogs()).toBe(true)
  })

  it('asks against the profile sub-module, not the app root', () => {
    const bridge = bridgeGranting()
    const spy = vi.spyOn(bridge, 'hasCapability')

    canSeeProfilePanel('panel.contacts')

    expect(spy).toHaveBeenCalledWith('remote.customer360.profile', 'panel.contacts')
  })
})
