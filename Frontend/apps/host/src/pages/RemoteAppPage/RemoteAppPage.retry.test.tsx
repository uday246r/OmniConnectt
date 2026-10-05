import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { useNavigationStore } from '../../shared/stores/navigationStore'
import type { NavNodeDto } from '../../shared/api/navigationApi'

/**
 * A remote that is down is retried a few times, then left for the user — not hammered forever.
 *
 * The page used to remount the error boundary on every attempt (`key={attempt}`), which reset the
 * boundary's automatic-retry budget each time: a remote that was simply offline was re-fetched every
 * two seconds for as long as the tab stayed open, by every user looking at it. This pins the budget:
 * the first load plus three automatic retries, then nothing until the user asks.
 */

const loadRemoteAppModule = vi.fn(() => Promise.reject(new Error('offline')))

vi.mock('../../shared/federation/remoteLoader', () => ({
  loadRemoteAppModule: () => loadRemoteAppModule(),
  needsReloadForNewVersion: () => false,
}))

const { RemoteAppPage } = await import('./RemoteAppPage')

const LEAD: NavNodeDto = {
  key: 'remote.lead',
  label: 'Lead Management',
  iconKey: null,
  routePath: '/apps/lead',
  page: null,
  order: 0,
  kind: 'remote-app',
  state: 'visible',
  maintenanceMessage: null,
  remote: { appKey: 'lead', manifestUrl: '/modules/lead/1.0.0/mf-manifest.json', containerName: 'lead_mf', defaultRoutePath: null },
  children: [{
    key: 'remote.lead.lead#view-lead', label: 'View Leads', iconKey: null, routePath: '/apps/lead/view-lead',
    page: 'view-lead', order: 0, kind: 'submodule', state: 'visible', maintenanceMessage: null, remote: null, children: [],
  }],
}

afterEach(() => {
  vi.useRealTimers()
})

describe('a remote that stays down', () => {
  it('is loaded once and retried three times automatically, then waits for the user', async () => {
    vi.useFakeTimers()
    vi.spyOn(console, 'error').mockImplementation(() => {})
    useNavigationStore.setState({
      status: 'loaded',
      sections: [{ key: 'apps', label: 'Apps', order: 0, pinToBottom: false, items: [LEAD] }],
      error: null,
      expanded: new Set(),
      // No session: the retry's navigation refresh is a no-op here.
      refresh: async () => {},
    })

    render(
      <MemoryRouter initialEntries={['/apps/lead/view-lead']}>
        <Routes>
          <Route path="/apps/:appKey/:page" element={<RemoteAppPage />} />
        </Routes>
      </MemoryRouter>,
    )

    // Long enough for every scheduled retry (2s, 5s, 10s) several times over.
    for (let i = 0; i < 60; i++) {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(1_000)
      })
    }

    expect(loadRemoteAppModule).toHaveBeenCalledTimes(4)
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument()
  })
})
