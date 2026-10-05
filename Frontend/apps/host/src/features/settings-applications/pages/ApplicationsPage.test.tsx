import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '../../../test/renderWithQuery'
import { useAuthStore } from '../../auth/store/authStore'
import { useSettingsDrawerStore } from '../../../shared/stores/settingsDrawerStore'
import type { RemoteAppDto } from '../api/remoteAppsApi'

const api = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  updateStatus: vi.fn(),
  resyncPermissions: vi.fn(),
}))

vi.mock('../api/remoteAppsApi', () => ({
  remoteAppsApi: api,
}))

const { ApplicationsPage } = await import('./ApplicationsPage')

function mockApp(over: Partial<RemoteAppDto> = {}): RemoteAppDto {
  return {
    id: crypto.randomUUID(),
    key: 'lead_mf',
    displayName: 'Lead Management',
    iconKey: 'Layers',
    manifestUrl: 'http://localhost:5001/remoteEntry.js',
    sidebarOrder: 1,
    status: 'Active',
    maintenanceMessage: null,
    permissionFeatureKey: 'remote.lead',
    permissionsSourceUrl: null,
    createdAt: '2026-01-10T08:00:00Z',
    updatedAt: '2026-01-10T08:00:00Z',
    ...over,
  }
}

describe('ApplicationsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsDrawerStore.getState().close()
    useAuthStore.setState({
      accessToken: 'test-token',
      user: {
        id: 'admin-1',
        name: 'Admin User',
        email: 'admin@example.com',
        roleId: 'role-admin',
        isAdministrator: true,
      },
    })

    api.list.mockResolvedValue({
      items: [
        mockApp({ id: 'app1', key: 'lead_mf', displayName: 'Lead Management', status: 'Active' }),
        mockApp({ id: 'app2', key: 'customer_mf', displayName: 'Customer 360', status: 'Maintenance' }),
      ],
      total: 2,
      page: 1,
      pageSize: 10,
    })
  })

  it('renders PageHeader, KPI cards, and applications table', async () => {
    renderWithQuery(<ApplicationsPage />, { route: '/settings/applications' })

    expect(screen.getByRole('heading', { name: 'Applications' })).toBeInTheDocument()
    expect(
      screen.getByText('Manage registered microfrontend applications, manifest endpoints, and runtime status.'),
    ).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Lead Management')).toBeInTheDocument()
      expect(screen.getByText('Customer 360')).toBeInTheDocument()
    })

    expect(screen.getByText('Total Applications')).toBeInTheDocument()
    expect(screen.getByText('In Maintenance')).toBeInTheDocument()
    expect(screen.getByText('Disabled')).toBeInTheDocument()
  })

  it('triggers drawer layer when clicking Register Application', async () => {
    renderWithQuery(<ApplicationsPage />, { route: '/settings/applications' })

    const addBtn = screen.getByRole('button', { name: /register application/i })
    addBtn.click()

    await waitFor(() => {
      const state = useSettingsDrawerStore.getState()
      expect(state.layerStack.at(-1)?.type).toBe('app-form')
    })
  })
})
