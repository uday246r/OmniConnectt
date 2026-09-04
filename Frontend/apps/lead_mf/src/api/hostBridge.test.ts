import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  canCreateLead,
  canDeleteLead,
  canEditLead,
  canExportAuditLogs,
  canSeeDashboardCapability,
  canViewAuditLogs,
  canViewDashboard,
  canViewLeads,
  getAccessToken,
  getCurrentUser,
  hasCapability,
  isRunningInHost,
  type OmniRemitHostBridge,
} from './hostBridge'

/**
 * How this remote decides what to show, which is entirely a question of what it asks the host.
 *
 * The host merges what the JWT carries with what it fetched separately, so this side never learns
 * which of the two answered — that is the point of the single `hasCapability` signature. What this
 * side *does* decide is which question to ask, and the helpers deliberately do not all ask the same
 * one. That asymmetry is invisible at the call sites, so it is what most of this file is about.
 */

function installBridge(over: Partial<OmniRemitHostBridge> = {}) {
  const bridge = {
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
  } as OmniRemitHostBridge

  window.__omniremitHost__ = bridge
  return bridge
}

/** A bridge that grants exactly the listed `featureKey:capability` pairs. */
function bridgeGranting(...granted: string[]) {
  return installBridge({
    hasCapability: (featureKey: string, capability: string) =>
      granted.includes(`${featureKey}:${capability}`),
  })
}

beforeEach(() => {
  delete window.__omniremitHost__
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
     * every capability is separately enforced by LeadService, which holds the data. If that ever
     * stops being true, this line is the first thing to revisit.
     */
    expect(hasCapability('remote.lead.lead', 'View')).toBe(true)
    expect(canSeeDashboardCapability('kpi.total-leads')).toBe(true)
  })

  it('has no token and no user', () => {
    expect(getAccessToken()).toBeNull()
    expect(getCurrentUser()).toBeNull()
  })
})

describe('running inside the host', () => {
  it('defers to the host for a capability it was not granted', () => {
    bridgeGranting()

    expect(hasCapability('remote.lead.lead', 'View')).toBe(false)
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
  // "May this user work with leads at all" is reasonably answered by being allowed into the app.
  it.each([
    ['canViewDashboard', canViewDashboard],
    ['canViewLeads', canViewLeads],
    ['canViewAuditLogs', canViewAuditLogs],
  ])('%s falls back to the app-level View', (_name, helper) => {
    bridgeGranting('remote.lead:View')

    expect(helper()).toBe(true)
  })

  it('the write helpers fall back to their own app-level verb, not to View', () => {
    // Being able to read the app must not imply being able to write in it.
    bridgeGranting('remote.lead:View')

    expect(canCreateLead()).toBe(false)
    expect(canEditLead()).toBe(false)
    expect(canDeleteLead()).toBe(false)
  })

  it('a sub-module grant is enough on its own', () => {
    bridgeGranting('remote.lead.lead:Delete')

    expect(canDeleteLead()).toBe(true)
    expect(canCreateLead()).toBe(false)
  })
})

describe('dashboard and export helpers do not fall back', () => {
  it('a KPI is not implied by being allowed into the app', () => {
    /*
     * The asymmetry, stated as plainly as it can be.
     *
     * If `canSeeDashboardCapability` fell back to `remote.lead:View` like the helpers above, everyone
     * who could open the app would see every card — and the per-card grant would exist in the editor,
     * be tickable, be stored, and mean absolutely nothing.
     */
    bridgeGranting('remote.lead:View', 'remote.lead.dashboard:View')

    expect(canViewDashboard()).toBe(true)
    expect(canSeeDashboardCapability('kpi.total-leads')).toBe(false)
    expect(canSeeDashboardCapability('chart.leads-over-time')).toBe(false)
  })

  it('nor is the audit export implied by being able to read the audit log', () => {
    bridgeGranting('remote.lead.auditlog:View', 'remote.lead:View')

    expect(canViewAuditLogs()).toBe(true)
    expect(canExportAuditLogs()).toBe(false)
  })

  it('a granted card is allowed, and only that one', () => {
    bridgeGranting('remote.lead.dashboard:kpi.new-leads')

    expect(canSeeDashboardCapability('kpi.new-leads')).toBe(true)
    expect(canSeeDashboardCapability('kpi.total-leads')).toBe(false)
    expect(canSeeDashboardCapability('kpi.converted')).toBe(false)
  })

  it('asks against the dashboard sub-module, not the app root', () => {
    const bridge = bridgeGranting()
    const spy = vi.spyOn(bridge, 'hasCapability')

    canSeeDashboardCapability('kpi.total-leads')

    expect(spy).toHaveBeenCalledWith('remote.lead.dashboard', 'kpi.total-leads')
  })

  it('a granted export is allowed', () => {
    bridgeGranting('remote.lead.auditlog:export.csv')

    expect(canExportAuditLogs()).toBe(true)
  })
})
