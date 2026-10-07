import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RemoteAppPage } from './RemoteAppPage'
import { useNavigationStore } from '../../shared/stores/navigationStore'
import type { NavNodeDto, NavSectionDto } from '../../shared/api/navigationApi'

/**
 * Where a user ends up when they type a remote app's URL and the navigation tree does not have it.
 *
 * The tree is the access decision: the server omits what the caller may not reach, so a missing node
 * means either "no such app" or "not yours". Both used to render the 404 page. They now redirect,
 * because the person on the other end is following a stale bookmark, not probing — and a 404 told
 * them the platform was broken. A page segment inside an app they DO have is kept inside that app,
 * which is nearer to where they were going than the dashboard is.
 *
 * None of these mount a remote: every gate runs before loadRemoteAppModule, and that ordering is the
 * reason an app the caller cannot reach is never even fetched.
 */

function node(over: Partial<NavNodeDto> = {}): NavNodeDto {
  return {
    key: 'lead', label: 'Lead Management', iconKey: null, routePath: '/apps/lead', page: null,
    order: 1, kind: 'remote-app', state: 'visible', maintenanceMessage: null,
    remote: {
      appKey: 'lead',
      manifestUrl: '/modules/lead/1.0.0/mf-manifest.json',
      containerName: 'lead_mf',
      defaultRoutePath: '/apps/lead/view-lead',
    },
    children: [],
    ...over,
  }
}

function sectionsWith(items: NavNodeDto[]): NavSectionDto[] {
  return [{ key: 'apps', label: 'Applications', order: 1, pinToBottom: false, items }]
}

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<p>dashboard</p>} />
        <Route path="/apps/:appKey" element={<RemoteAppPage />} />
        <Route path="/apps/:appKey/:page" element={<RemoteAppPage />} />
        <Route path="/apps/lead/view-lead" element={<p>view leads</p>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  useNavigationStore.setState({ status: 'loaded', sections: [] })
})

describe('RemoteAppPage access', () => {
  it('sends a user to the dashboard for an app that is not in their tree', () => {
    useNavigationStore.setState({ sections: sectionsWith([]) })

    renderAt('/apps/lead')

    expect(screen.getByText('dashboard')).toBeInTheDocument()
  })

  it('keeps a user inside the app when only the page segment is unknown', () => {
    // They do have this app; the nearest useful place is its own first page, not the dashboard.
    useNavigationStore.setState({ sections: sectionsWith([node()]) })

    renderAt('/apps/lead/does-not-exist')

    expect(screen.getByText('view leads')).toBeInTheDocument()
    expect(screen.queryByText('dashboard')).not.toBeInTheDocument()
  })

  it('waits while the navigation tree is still loading instead of redirecting', () => {
    useNavigationStore.setState({ status: 'loading', sections: [] })

    renderAt('/apps/lead')

    expect(screen.queryByText('dashboard')).not.toBeInTheDocument()
  })
})
