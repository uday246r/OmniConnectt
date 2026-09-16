import { act, render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useNavigate } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../../features/auth/store/authStore'
import { useSettingsDrawerStore } from '../../shared/stores/settingsDrawerStore'
import { SettingsDrawerUrlSync, useSettingsBackgroundLocation } from '../SettingsDrawer/SettingsDrawerUrlSync'

/**
 * The settings gear must actually open the drawer.
 *
 * AppShell renders inside the page routes, and while a /settings URL is open those routes render the
 * page BEHIND the drawer. AppShell used to close the drawer whenever its location was not a settings
 * URL — which, from where it sits, is always — so clicking the gear changed the address to
 * /settings/roles and the drawer closed in the same tick. This renders the real AppShell the way App
 * does and checks the drawer is still open and mounted after the URL changes.
 */

vi.mock('../Sidebar/Sidebar', () => ({ Sidebar: () => null }))
vi.mock('../Topbar/Topbar', () => ({ Topbar: () => null }))
vi.mock('../../shared/components/Toast', () => ({ ToastContainer: () => null }))
vi.mock('../SettingsDrawer/SettingsDrawer', () => ({
  SettingsDrawer: () => <div role="dialog" aria-label="System Settings" />,
}))

const { AppShell } = await import('./AppShell')

let go: (to: string) => void = () => undefined
function Navigator() {
  const navigate = useNavigate()
  go = (to) => act(() => navigate(to))
  return null
}

function PageRoutes() {
  const location = useSettingsBackgroundLocation()
  return (
    <Routes location={location}>
      <Route element={<AppShell />}>
        <Route path="*" element={<p>page behind</p>} />
      </Route>
    </Routes>
  )
}

function renderApp(start: string) {
  return render(
    <MemoryRouter initialEntries={[start]}>
      <Navigator />
      <SettingsDrawerUrlSync />
      <PageRoutes />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  useSettingsDrawerStore.setState({ isOpen: false, activeTab: 'users', layerStack: [{ type: 'root', tab: 'users' }], returnPath: '/apps/products/dashboard' })
  useAuthStore.setState({
    status: 'authenticated',
    user: { id: 'u', name: 'Admin', email: 'a@example.com', isAdministrator: true, permissions: [] } as never,
    fineCapabilities: [],
  })
})

describe('AppShell with the settings drawer', () => {
  it('keeps the drawer open after the gear navigates to /settings', async () => {
    renderApp('/apps/products/dashboard')

    go('/settings')

    expect(useSettingsDrawerStore.getState().isOpen).toBe(true)
    expect(await screen.findByRole('dialog', { name: 'System Settings' })).toBeInTheDocument()
    expect(screen.getByText('page behind')).toBeInTheDocument()
  })

  it('keeps it open while switching tabs, and closes it on leaving settings', async () => {
    renderApp('/apps/products/dashboard')
    go('/settings/roles')
    go('/settings/applications')
    expect(await screen.findByRole('dialog', { name: 'System Settings' })).toBeInTheDocument()

    go('/apps/products/dashboard')

    expect(useSettingsDrawerStore.getState().isOpen).toBe(false)
    expect(screen.queryByRole('dialog', { name: 'System Settings' })).not.toBeInTheDocument()
  })
})
