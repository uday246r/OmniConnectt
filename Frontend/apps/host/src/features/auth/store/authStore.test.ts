import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from './authStore'
import type { CurrentUserDto } from '../../../shared/api/authServiceClient'

/**
 * `hasCapability` answers from two sources and never says which.
 *
 * API capabilities ride in the access token; widgets, charts, exports and panels are fetched
 * separately so the token cannot grow past what a proxy will forward. Every caller in the host, and
 * every remote reaching through `window.__omniconnectHost__`, asks the same question either way — so
 * the merge is the whole contract, and these tests are what stop it silently coming apart.
 */

function user(over: Partial<CurrentUserDto> = {}): CurrentUserDto {
  return {
    id: 'a2f2d0f0-0000-0000-0000-000000000001',
    name: 'Tester',
    email: 'tester@example.com',
    isAdministrator: false,
    permissions: [],
    ...over,
  } as CurrentUserDto
}

function signIn(over: Partial<CurrentUserDto> = {}, fineCapabilities: string[] = []) {
  useAuthStore.setState({ status: 'authenticated', user: user(over), fineCapabilities })
}

beforeEach(() => {
  useAuthStore.setState({ status: 'unauthenticated', user: null, fineCapabilities: [] })
})

describe('hasCapability', () => {
  it('answers from the token for an API capability', () => {
    signIn({ permissions: ['remote.lead.lead:View'] })

    expect(useAuthStore.getState().hasCapability('remote.lead.lead', 'View')).toBe(true)
  })

  it('answers from the fetched set for a capability the token deliberately omits', () => {
    // The KPI is not in `permissions` and never will be. Before the merge this returned false, which
    // would have hidden every widget from everyone.
    signIn({}, ['remote.lead.dashboard:kpi.total-leads'])

    expect(useAuthStore.getState().hasCapability('remote.lead.dashboard', 'kpi.total-leads')).toBe(true)
  })

  it('is false for a capability in neither source', () => {
    signIn({ permissions: ['remote.lead.lead:View'] }, ['remote.lead.dashboard:kpi.total-leads'])

    expect(useAuthStore.getState().hasCapability('remote.lead.dashboard', 'kpi.converted')).toBe(false)
  })

  it('is false before the fetched set has arrived, rather than optimistic', () => {
    // The set loads asynchronously after sign-in. Until it does, the honest answer is no: showing a
    // widget and then removing it is worse than showing it a moment late, and guessing yes would
    // briefly reveal something the user may not hold.
    signIn({ permissions: ['remote.lead.dashboard:View'] })

    expect(useAuthStore.getState().hasCapability('remote.lead.dashboard', 'kpi.total-leads')).toBe(false)
  })

  it('grants everything to an administrator without consulting either source', () => {
    signIn({ isAdministrator: true })

    expect(useAuthStore.getState().hasCapability('remote.lead.dashboard', 'kpi.total-leads')).toBe(true)
    expect(useAuthStore.getState().hasCapability('anything.at.all', 'Whatever')).toBe(true)
  })

  it('is false with no session at all', () => {
    expect(useAuthStore.getState().hasCapability('remote.lead.lead', 'View')).toBe(false)
  })

  it('does not match a capability of one feature against another', () => {
    // The failure this guards against has happened before in this codebase: a prefix comparison
    // collapsed every module of an app into one, so a read-only viewer passed a delete check.
    signIn({}, ['remote.lead.dashboard:kpi.total-leads'])

    expect(useAuthStore.getState().hasCapability('remote.customer360.profile', 'kpi.total-leads')).toBe(false)
    expect(useAuthStore.getState().hasCapability('remote.lead', 'kpi.total-leads')).toBe(false)
  })
})
