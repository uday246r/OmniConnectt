import { act, render } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../../features/auth/store/authStore'
import { useNavigationStore } from '../stores/navigationStore'
import type { NavSectionDto } from '../api/navigationApi'
import { isTrackablePage, PAGE_VIEW_SETTLE_MS, usePageViewTracking } from './usePageViewTracking'

vi.mock('../../features/system-audit-logs/api/auditLogsApi', () => ({
  auditLogsApi: { recordPageView: vi.fn(() => Promise.resolve()) },
}))
import { auditLogsApi } from '../../features/system-audit-logs/api/auditLogsApi'

/**
 * Which address changes the host reports as page views.
 *
 * Page views are recorded from the shell, for host and remote pages alike. Reporting every address
 * change would fill the audit trail with things nobody opened: "/apps/lead" for the instant before it
 * redirects to the app's first page, the edit form stacked on a settings drawer, an app showing only
 * its maintenance notice. These pin that only settled, real pages are sent, and that sending never
 * waits on or breaks the page.
 */

const recordPageView = vi.mocked(auditLogsApi.recordPageView)

const sections: NavSectionDto[] = [
  {
    key: 'apps', label: 'Apps', order: 20, pinToBottom: false,
    items: [
      {
        key: 'remote.lead', label: 'Lead Management', iconKey: null, routePath: '/apps/lead', page: null, order: 10,
        kind: 'remote-app', state: 'visible', maintenanceMessage: null,
        remote: { appKey: 'lead', manifestUrl: 'x', containerName: 'lead_mf', defaultRoutePath: '/apps/lead/view-lead' },
        children: [
          { key: 'remote.lead.lead#view-lead', label: 'View Leads', iconKey: null, routePath: '/apps/lead/view-lead', page: 'view-lead', order: 10, kind: 'submodule', state: 'visible', maintenanceMessage: null, remote: null, children: [] },
        ],
      },
      {
        key: 'remote.c360', label: 'Customer 360', iconKey: null, routePath: '/apps/c360', page: null, order: 20,
        kind: 'remote-app', state: 'maintenance', maintenanceMessage: 'Back soon',
        remote: { appKey: 'c360', manifestUrl: 'x', containerName: 'c360', defaultRoutePath: null },
        children: [],
      },
    ],
  },
] as unknown as NavSectionDto[]

describe('isTrackablePage', () => {
  it.each([
    ['/apps/lead/view-lead', true],
    ['/system/audit-logs', true],
    ['/settings/roles', true],
    ['/settings/users/0b7c1c55-8d0f-4c0e-9d7e-3f3e0a1d2b4c', true],
    ['/apps/lead', false],               // redirects to the first page
    ['/apps/c360', false],               // maintenance notice, not the app
    ['/settings', false],                // redirects to a tab
    ['/settings/roles/new', false],      // a form on the drawer
    ['/settings/users/new', false],
    ['/404', false],
    ['/login', false],
  ])('%s → %s', (path, expected) => {
    expect(isTrackablePage(path, sections)).toBe(expected)
  })
})

let go: (to: string) => void = () => undefined
function Tracker() {
  const navigate = useNavigate()
  go = (to) => act(() => navigate(to))
  usePageViewTracking()
  return null
}

beforeEach(() => {
  vi.useFakeTimers()
  recordPageView.mockClear()
  useAuthStore.setState({ status: 'authenticated', ensureFreshAccessToken: () => Promise.resolve('tok') } as never)
  useNavigationStore.setState({ status: 'loaded', sections })
})

afterEach(() => {
  vi.useRealTimers()
})

async function settle() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(PAGE_VIEW_SETTLE_MS)
  })
}

describe('usePageViewTracking', () => {
  it('reports a page once it has settled, with only its route', async () => {
    render(<MemoryRouter initialEntries={['/apps/lead/view-lead']}><Tracker /></MemoryRouter>)

    await settle()

    expect(recordPageView).toHaveBeenCalledTimes(1)
    expect(recordPageView).toHaveBeenCalledWith('tok', '/apps/lead/view-lead')
  })

  it('does not report a page that was left before it settled', async () => {
    render(<MemoryRouter initialEntries={['/system/audit-logs']}><Tracker /></MemoryRouter>)

    go('/system/system-logs')
    await settle()

    expect(recordPageView).toHaveBeenCalledTimes(1)
    expect(recordPageView).toHaveBeenCalledWith('tok', '/system/system-logs')
  })

  it('waits for the navigation tree before deciding anything', async () => {
    useNavigationStore.setState({ status: 'loading', sections: [] })
    render(<MemoryRouter initialEntries={['/apps/lead']}><Tracker /></MemoryRouter>)

    await settle()

    expect(recordPageView).not.toHaveBeenCalled()
  })

  it('never lets a failed report reach the page', async () => {
    recordPageView.mockRejectedValueOnce(new Error('429'))
    render(<MemoryRouter initialEntries={['/system/audit-logs']}><Tracker /></MemoryRouter>)

    await expect(settle()).resolves.toBeUndefined()
  })

  it('sends nothing when signed out', async () => {
    useAuthStore.setState({ status: 'unauthenticated' } as never)
    render(<MemoryRouter initialEntries={['/system/audit-logs']}><Tracker /></MemoryRouter>)

    await settle()

    expect(recordPageView).not.toHaveBeenCalled()
  })
})
