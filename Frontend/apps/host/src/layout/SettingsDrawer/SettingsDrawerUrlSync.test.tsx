import { act, render, screen } from '@testing-library/react'
import { useEffect } from 'react'
import { MemoryRouter, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { useAuthStore } from '../../features/auth/store/authStore'
import { useSettingsDrawerStore } from '../../shared/stores/settingsDrawerStore'
import { SettingsDrawerUrlSync, useSettingsBackgroundLocation } from './SettingsDrawerUrlSync'

/**
 * Opening Settings must not reload the page behind it.
 *
 * Drawer URLs used to be routes that rendered a fresh copy of the page the operator came from, so every
 * click on the gear unmounted the dashboard (or the remote app, or the user's profile) and mounted a new
 * one that fetched everything again — and did it once more on close. A half-filled form in a remote was
 * lost, and a remote page rendered "not found" because the copy had no app key. These pin that the
 * background page is the same mounted component throughout, and that the drawer opens with the right
 * tab and form only for someone allowed to see it.
 */

const mounts: Record<string, number> = {}

function CountingPage({ name }: { name: string }) {
  useEffect(() => {
    mounts[name] = (mounts[name] ?? 0) + 1
  }, [name])
  return <p>{name} page</p>
}

function RemotePage() {
  const { appKey, page } = useParams()
  return <p>{`remote ${appKey}/${page}`}</p>
}

let go: (to: string) => void = () => undefined
function Navigator() {
  const navigate = useNavigate()
  go = (to) => act(() => navigate(to))
  return null
}

function Harness({ start }: { start: string }) {
  return (
    <MemoryRouter initialEntries={[start]}>
      <Navigator />
      <SettingsDrawerUrlSync />
      <PageRoutes />
    </MemoryRouter>
  )
}

function PageRoutes() {
  const location = useSettingsBackgroundLocation()
  return (
    <Routes location={location}>
      <Route path="/" element={<CountingPage name="dashboard" />} />
      <Route path="/apps/:appKey/:page" element={<RemotePage />} />
      <Route path="/settings/users/:id" element={<CountingPage name="user-detail" />} />
      <Route path="/404" element={<p>not found</p>} />
    </Routes>
  )
}

function signIn(isAdministrator: boolean, permissions: string[] = []) {
  useAuthStore.setState({
    status: 'authenticated',
    user: { id: 'u', name: 'U', email: 'u@example.com', isAdministrator, permissions } as never,
    fineCapabilities: [],
  })
}

beforeEach(() => {
  for (const key of Object.keys(mounts)) delete mounts[key]
  useSettingsDrawerStore.setState({ isOpen: false, activeTab: 'users', layerStack: [{ type: 'root', tab: 'users' }], returnPath: '/' })
  signIn(true)
})

describe('the page behind the drawer', () => {
  it('stays mounted when Settings opens and closes', () => {
    render(<Harness start="/" />)
    expect(mounts.dashboard).toBe(1)

    go('/settings/roles')
    expect(screen.getByText('dashboard page')).toBeInTheDocument()
    expect(useSettingsDrawerStore.getState().isOpen).toBe(true)

    go('/settings/applications')
    go('/')

    expect(mounts.dashboard).toBe(1)
  })

  it('keeps a remote app page, with its own address, behind the drawer', () => {
    useSettingsDrawerStore.setState({ returnPath: '/apps/lead/create-lead' })
    render(<Harness start="/apps/lead/create-lead" />)

    go('/settings/roles')

    expect(screen.getByText('remote lead/create-lead')).toBeInTheDocument()
    expect(screen.queryByText('not found')).not.toBeInTheDocument()
  })

  it('keeps a user profile behind the drawer rather than swapping in another page', () => {
    useSettingsDrawerStore.setState({ returnPath: '/settings/users/42' })
    render(<Harness start="/settings/users/42" />)

    go('/settings/checker-assignment')

    expect(screen.getByText('user-detail page')).toBeInTheDocument()
    expect(mounts['user-detail']).toBe(1)
  })
})

describe('the drawer follows the real URL, not the page behind it', () => {
  /*
   * The regression this pins: the close-on-leave rule lived in AppShell, which renders inside the page
   * routes and so only ever saw the page BEHIND the drawer. That page is never a settings URL, so the
   * rule closed the drawer the instant the gear opened it, and Settings never appeared.
   */
  function ShellCloseRule() {
    // Stands in for anything rendered inside the page routes: it sees the background location.
    const { pathname } = useLocation()
    return <p data-testid="inner-path">{pathname}</p>
  }

  function ShellHarness({ start }: { start: string }) {
    return (
      <MemoryRouter initialEntries={[start]}>
        <Navigator />
        <SettingsDrawerUrlSync />
        <BackgroundRoutes />
      </MemoryRouter>
    )
  }

  function BackgroundRoutes() {
    const location = useSettingsBackgroundLocation()
    return (
      <Routes location={location}>
        <Route path="*" element={<ShellCloseRule />} />
      </Routes>
    )
  }

  it('stays open after the gear sends a bare /settings, even though the page routes still see the dashboard', () => {
    useSettingsDrawerStore.setState({ returnPath: '/apps/products/dashboard' })
    render(<ShellHarness start="/apps/products/dashboard" />)

    go('/settings')

    expect(screen.getByTestId('inner-path')).toHaveTextContent('/apps/products/dashboard')
    expect(useSettingsDrawerStore.getState().isOpen).toBe(true)
    expect(useSettingsDrawerStore.getState().activeTab).toBe('roles')
  })

  it('closes when the operator navigates to a page that is not a settings screen', () => {
    render(<ShellHarness start="/" />)
    go('/settings/applications')
    expect(useSettingsDrawerStore.getState().isOpen).toBe(true)

    go('/system/audit-logs')

    expect(useSettingsDrawerStore.getState().isOpen).toBe(false)
  })

  it('keeps a form a page opened on itself until the operator leaves that page', () => {
    render(<ShellHarness start="/settings/users" />)
    act(() => useSettingsDrawerStore.getState().pushLayer({ type: 'user-form', userId: 'u-7' }))
    expect(useSettingsDrawerStore.getState().isOpen).toBe(true)

    go('/my-requests')

    expect(useSettingsDrawerStore.getState().isOpen).toBe(false)
  })
})

describe('opening the drawer from a URL', () => {
  it('opens only the checker-assignment section for someone whose only settings permission is that', () => {
    signIn(false, ['host.system.checker-assignment:View'])
    render(<Harness start="/settings" />)

    expect(useSettingsDrawerStore.getState().activeTab).toBe('checker-assignment')
    expect(useSettingsDrawerStore.getState().isOpen).toBe(true)
  })

  it('opens the first tab the operator can use for a bare /settings', () => {
    signIn(false, ['host.settings.applications:View'])
    render(<Harness start="/settings" />)

    expect(useSettingsDrawerStore.getState().activeTab).toBe('applications')
  })

  it('opens a record for editing from its address', () => {
    render(<Harness start="/settings/roles/r-1" />)

    const { activeTab, layerStack } = useSettingsDrawerStore.getState()
    expect(activeTab).toBe('roles')
    expect(layerStack.at(-1)).toEqual({ type: 'role-form', roleId: 'r-1' })
  })

  it('opens the create-user form', () => {
    render(<Harness start="/settings/users/new" />)

    expect(useSettingsDrawerStore.getState().layerStack.at(-1)).toEqual({ type: 'user-form' })
  })

  it('refuses a drawer the operator has no permission for', () => {
    signIn(false, ['host.settings.roles:View'])
    render(<Harness start="/settings/roles/new" />)

    expect(screen.getByText('not found')).toBeInTheDocument()
    expect(useSettingsDrawerStore.getState().isOpen).toBe(false)
  })
})
