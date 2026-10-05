import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useNavigationStore } from '../../shared/stores/navigationStore'
import type { NavNodeDto, NavSectionDto } from '../../shared/api/navigationApi'

/**
 * Access is decided BEFORE the remote is fetched.
 *
 * The assertion that matters most here is the negative one: loadRemoteAppModule must never be called
 * for an app the caller may not use. Previously this page checked only the registry's status and
 * mounted for any authenticated user, so a remote's bundle was downloadable by typing its URL — the
 * gate existed in the sidebar, which is presentation, not enforcement.
 */
const loadRemoteAppModule = vi.fn()
const needsReloadForNewVersion = vi.fn(() => false)
let remoteProps: Record<string, unknown> = {}

vi.mock('../../shared/federation/remoteLoader', () => ({
  loadRemoteAppModule: (...args: unknown[]) => {
    loadRemoteAppModule(...args)
    return Promise.resolve({
      default: (props: Record<string, unknown>) => {
        remoteProps = props
        return <div>remote content</div>
      },
    })
  },
  needsReloadForNewVersion: (...args: unknown[]) => needsReloadForNewVersion(...(args as [])),
}))

// Imported after the mock so the page picks up the stub.
const { RemoteAppPage } = await import('./RemoteAppPage')

function node(over: Partial<NavNodeDto> & Pick<NavNodeDto, 'key' | 'label' | 'routePath'>): NavNodeDto {
  return {
    iconKey: null,
    page: null,
    order: 0,
    kind: 'host',
    state: 'visible',
    maintenanceMessage: null,
    remote: null,
    children: [],
    ...over,
  }
}

const LEAD = node({
  key: 'remote.lead',
  label: 'Lead Management',
  routePath: '/apps/lead',
  kind: 'remote-app',
  remote: {
    appKey: 'lead',
    manifestUrl: 'http://localhost:5002/mf-manifest.json',
    containerName: 'lead_mf',
    defaultRoutePath: '/apps/lead/view-lead',
  },
  children: [
    node({ key: 'remote.lead.lead#view-lead', label: 'View Leads', routePath: '/apps/lead/view-lead', kind: 'submodule', page: 'view-lead' }),
  ],
})

function sections(items: NavNodeDto[]): NavSectionDto[] {
  return [{ key: 'apps', label: 'Apps', order: 20, pinToBottom: false, items }]
}

function renderAt(route: string, tree: NavNodeDto[]) {
  useNavigationStore.setState({ status: 'loaded', sections: sections(tree), error: null, expanded: new Set() })
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Routes>
        <Route path="/apps/:appKey" element={<RemoteAppPage />} />
        <Route path="/apps/:appKey/:page" element={<RemoteAppPage />} />
        <Route path="/apps/:appKey/:page/*" element={<RemoteAppPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  loadRemoteAppModule.mockClear()
  needsReloadForNewVersion.mockReset()
  needsReloadForNewVersion.mockReturnValue(false)
  remoteProps = {}
  useNavigationStore.setState({ status: 'idle', sections: [], error: null, expanded: new Set() })
})

describe('access is checked before the remote loads', () => {
  it('never fetches the bundle for an app the tree omitted', async () => {
    // Absent from the tree means either no such app or no access. Both answer 404 — distinguishing
    // them would confirm the existence of apps the caller cannot use.
    renderAt('/apps/lead/view-lead', [])

    expect(await screen.findByText('404')).toBeInTheDocument()
    expect(loadRemoteAppModule).not.toHaveBeenCalled()
  })

  it('never fetches the bundle for an app under maintenance', async () => {
    renderAt('/apps/lead', [{ ...LEAD, state: 'maintenance', maintenanceMessage: 'Back at 09:00.' }])

    expect(await screen.findByText(/under maintenance/i)).toBeInTheDocument()
    expect(loadRemoteAppModule).not.toHaveBeenCalled()
  })

  it('answers 404 for a page segment the app does not declare', async () => {
    renderAt('/apps/lead/not-a-page', [LEAD])

    expect(await screen.findByText('404')).toBeInTheDocument()
    expect(loadRemoteAppModule).not.toHaveBeenCalled()
  })
})

describe('direct URL access to a permitted page', () => {
  it('mounts the remote and hands it the page from the URL', async () => {
    renderAt('/apps/lead/view-lead', [LEAD])

    expect(await screen.findByText('remote content')).toBeInTheDocument()
    expect(loadRemoteAppModule).toHaveBeenCalledWith(
      expect.objectContaining({ key: 'lead', manifestUrl: 'http://localhost:5002/mf-manifest.json' }),
    )
  })

  it('redirects the app root to the first page the caller can see', async () => {
    // Not to whichever page the remote defaults to internally — that may be one they cannot access.
    renderAt('/apps/lead', [LEAD])

    expect(await screen.findByText('remote content')).toBeInTheDocument()
  })
})

describe('while the tree is still loading', () => {
  it('shows a placeholder rather than a premature 404', async () => {
    useNavigationStore.setState({ status: 'loading', sections: [], error: null, expanded: new Set() })
    render(
      <MemoryRouter initialEntries={['/apps/lead']}>
        <Routes>
          <Route path="/apps/:appKey" element={<RemoteAppPage />} />
        </Routes>
      </MemoryRouter>,
    )

    expect(screen.queryByText('404')).not.toBeInTheDocument()
    expect(loadRemoteAppModule).not.toHaveBeenCalled()
  })
})

describe('maintenance and releases', () => {
  it('shows the maintenance notice when the server sent no manifest URL', async () => {
    // A caller without the bypass capability is not told where an app in maintenance lives.
    renderAt('/apps/lead/view-lead', [{ ...LEAD, state: 'maintenance', remote: { ...LEAD.remote!, manifestUrl: null } }])

    expect(await screen.findByText(/under maintenance/i)).toBeInTheDocument()
    expect(loadRemoteAppModule).not.toHaveBeenCalled()
  })

  it('mounts the app, with a notice, for a caller allowed past maintenance', async () => {
    renderAt('/apps/lead/view-lead', [{ ...LEAD, state: 'maintenance-bypass', maintenanceMessage: 'Back at 09:00.' }])

    expect(await screen.findByText('remote content')).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent(/maintenance access/i)
  })

  it('offers a reload instead of mounting a newer build beside the one this tab already runs', async () => {
    needsReloadForNewVersion.mockReturnValue(true)

    renderAt('/apps/lead/view-lead', [LEAD])

    expect(await screen.findByRole('button', { name: /reload now/i })).toBeInTheDocument()
    expect(loadRemoteAppModule).not.toHaveBeenCalled()
  })
})

describe('deep links', () => {
  it('hands the remote whatever follows the page in the URL', async () => {
    renderAt('/apps/lead/view-lead/42/history', [LEAD])

    expect(await screen.findByText('remote content')).toBeInTheDocument()
    expect(remoteProps).toMatchObject({ page: 'view-lead', subPath: '42/history' })
  })
})
