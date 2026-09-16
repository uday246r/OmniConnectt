import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SettingsDrawer } from './SettingsDrawer'
import { isDrawerRoute, useSettingsDrawerStore } from '../../shared/stores/settingsDrawerStore'
import { useAuthStore } from '../../features/auth/store/authStore'

// Minimal mock for child tab components to isolate SettingsDrawer shell
vi.mock('./SettingsRolesTab', () => ({
  SettingsRolesTab: () => <div data-testid="roles-tab">Roles Tab Content</div>,
}))
vi.mock('./SettingsApplicationsTab', () => ({
  SettingsApplicationsTab: () => <div data-testid="apps-tab">Applications Tab Content</div>,
}))
vi.mock('./SettingsCheckerAssignmentTab', () => ({
  SettingsCheckerAssignmentTab: () => <div data-testid="checker-tab">Checker Assignment Tab Content</div>,
}))
vi.mock('./UserFormLayer', () => ({
  UserFormLayer: ({ userId }: { userId?: string }) => (
    <div data-testid="user-form-layer">
      User Form Content: {userId ? `Editing ${userId}` : 'Creating New User'}
    </div>
  ),
}))

function LocationTracker() {
  const location = useLocation()
  return <div data-testid="current-location">{`${location.pathname}${location.search}`}</div>
}

function renderDrawer(initialRoute = '/settings/roles') {
  return render(
    <MemoryRouter initialEntries={[initialRoute]}>
      <LocationTracker />
      <SettingsDrawer />
    </MemoryRouter>,
  )
}

describe('isDrawerRoute', () => {
  it('identifies drawer-hosted routes correctly', () => {
    expect(isDrawerRoute('/settings')).toBe(true)
    expect(isDrawerRoute('/settings/')).toBe(true)
    expect(isDrawerRoute('/settings/roles')).toBe(true)
    expect(isDrawerRoute('/settings/roles/new')).toBe(true)
    expect(isDrawerRoute('/settings/roles/role-123')).toBe(true)
    expect(isDrawerRoute('/settings/applications')).toBe(true)
    expect(isDrawerRoute('/settings/checker-assignment')).toBe(true)
    expect(isDrawerRoute('/settings/users/new')).toBe(true)
  })

  it('identifies non-drawer pages correctly', () => {
    expect(isDrawerRoute('/settings/users')).toBe(false)
    expect(isDrawerRoute('/settings/users/user-123')).toBe(false)
    expect(isDrawerRoute('/')).toBe(false)
    expect(isDrawerRoute('/profile')).toBe(false)
    expect(isDrawerRoute('/apps/lead/view-lead')).toBe(false)
    expect(isDrawerRoute('/system/audit-logs')).toBe(false)
    expect(isDrawerRoute('/system/approvals')).toBe(false)
    expect(isDrawerRoute('/my-requests')).toBe(false)
  })

  it('handles query parameters and trailing slashes', () => {
    expect(isDrawerRoute('/settings/roles?tab=permissions')).toBe(true)
    expect(isDrawerRoute('/settings/users?page=2')).toBe(false)
    expect(isDrawerRoute('/settings/users/')).toBe(false)
  })
})

describe('settingsDrawerStore returnPath handling', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useSettingsDrawerStore.setState({
      isOpen: false,
      activeTab: 'roles',
      layerStack: [{ type: 'root', tab: 'roles' }],
      returnPath: '/',
    })
  })

  it('sets returnPath and persists to sessionStorage', () => {
    useSettingsDrawerStore.getState().setReturnPath('/settings/users')
    expect(useSettingsDrawerStore.getState().returnPath).toBe('/settings/users')
    expect(sessionStorage.getItem('omni_settings_return_path')).toBe('/settings/users')
  })

  it('ignores drawer routes from becoming returnPath', () => {
    useSettingsDrawerStore.getState().setReturnPath('/settings/users')
    useSettingsDrawerStore.getState().setReturnPath('/settings/roles')
    // Should still remain /settings/users
    expect(useSettingsDrawerStore.getState().returnPath).toBe('/settings/users')
  })
})

describe('SettingsDrawer close button and backdrop click', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useAuthStore.setState({
      user: {
        id: 'admin-1',
        name: 'Super Admin',
        email: 'admin@omniconnect.com',
        isAdministrator: true,
      },
      status: 'authenticated',
    })
    useSettingsDrawerStore.setState({
      isOpen: true,
      activeTab: 'roles',
      layerStack: [{ type: 'root', tab: 'roles' }],
      returnPath: '/settings/users',
    })
  })

  it('closes drawer and navigates to previous page when cross button is clicked', async () => {
    const user = userEvent.setup()
    renderDrawer('/settings/roles')

    // System Settings title and cross button should be visible
    expect(screen.getByRole('heading', { name: 'System Settings' })).toBeInTheDocument()
    const closeButton = screen.getByRole('button', { name: 'Close Settings' })

    await user.click(closeButton)

    // Store state should be closed
    expect(useSettingsDrawerStore.getState().isOpen).toBe(false)

    // Location should have returned to /settings/users (the previous page)
    expect(screen.getByTestId('current-location')).toHaveTextContent('/settings/users')
  })

  it('closes drawer and navigates to previous page when backdrop is clicked', async () => {
    useSettingsDrawerStore.setState({
      isOpen: true,
      activeTab: 'roles',
      layerStack: [{ type: 'root', tab: 'roles' }],
      returnPath: '/system/audit-logs',
    })

    const user = userEvent.setup()
    const { container } = renderDrawer('/settings/roles')

    // Backdrop element
    const backdrop = container.querySelector('[class*="backdrop"]')
    expect(backdrop).not.toBeNull()

    await user.click(backdrop!)

    // Store state should be closed
    expect(useSettingsDrawerStore.getState().isOpen).toBe(false)

    // Location should have returned to /system/audit-logs
    expect(screen.getByTestId('current-location')).toHaveTextContent('/system/audit-logs')
  })

  it('falls back to / if returnPath is a drawer route or empty', async () => {
    useSettingsDrawerStore.setState({
      isOpen: true,
      activeTab: 'roles',
      layerStack: [{ type: 'root', tab: 'roles' }],
      returnPath: '/settings/roles',
    })

    const user = userEvent.setup()
    renderDrawer('/settings/roles')

    const closeButton = screen.getByRole('button', { name: 'Close Settings' })
    await user.click(closeButton)

    expect(useSettingsDrawerStore.getState().isOpen).toBe(false)
    expect(screen.getByTestId('current-location')).toHaveTextContent('/')
  })
})

describe('SettingsDrawer user-form override layer and popLayer', () => {
  beforeEach(() => {
    sessionStorage.clear()
    useAuthStore.setState({
      user: {
        id: 'admin-1',
        name: 'Super Admin',
        email: 'admin@omniconnect.com',
        isAdministrator: true,
      },
      status: 'authenticated',
    })
  })

  it('renders user-form layer for Add User when pushed', () => {
    useSettingsDrawerStore.setState({
      isOpen: true,
      activeTab: 'users',
      layerStack: [{ type: 'root', tab: 'users' }, { type: 'user-form' }],
      returnPath: '/settings/users',
    })

    renderDrawer('/settings/users')

    expect(screen.getByTestId('user-form-layer')).toHaveTextContent('Creating New User')
  })

  it('renders user-form layer with userId for Edit User when pushed', () => {
    useSettingsDrawerStore.setState({
      isOpen: true,
      activeTab: 'users',
      layerStack: [{ type: 'root', tab: 'users' }, { type: 'user-form', userId: 'user-456' }],
      returnPath: '/settings/users/user-456',
    })

    renderDrawer('/settings/users/user-456')

    expect(screen.getByTestId('user-form-layer')).toHaveTextContent('Editing user-456')
  })

  it('closes drawer on Escape when user-form is active', async () => {
    useSettingsDrawerStore.setState({
      isOpen: true,
      activeTab: 'users',
      layerStack: [{ type: 'root', tab: 'users' }, { type: 'user-form' }],
      returnPath: '/settings/users',
    })

    const user = userEvent.setup()
    renderDrawer('/settings/users')

    expect(screen.getByTestId('user-form-layer')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(useSettingsDrawerStore.getState().isOpen).toBe(false)
  })

  it('popLayer safely closes drawer when popping user-form down to users root', () => {
    useSettingsDrawerStore.setState({
      isOpen: true,
      activeTab: 'users',
      layerStack: [{ type: 'root', tab: 'users' }, { type: 'user-form' }],
      returnPath: '/settings/users',
    })

    useSettingsDrawerStore.getState().popLayer()

    // Since root tab is 'users' (which has no drawer panel), drawer should close rather than render empty
    expect(useSettingsDrawerStore.getState().isOpen).toBe(false)
  })
})
