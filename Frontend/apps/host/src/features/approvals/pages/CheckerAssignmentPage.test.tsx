import { fireEvent, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '../../../test/renderWithQuery'
import { useAuthStore } from '../../auth/store/authStore'
import { useSettingsDrawerStore } from '../../../shared/stores/settingsDrawerStore'
import type { AssignableModuleDto, CheckerAssignmentDto } from '../api/checkerAssignmentsApi'

const checkerApi = vi.hoisted(() => ({
  list: vi.fn(),
  listModules: vi.fn(),
  upsert: vi.fn(),
  bulkUpsert: vi.fn(),
  remove: vi.fn(),
}))

const remoteAppsApi = vi.hoisted(() => ({
  list: vi.fn(),
}))

vi.mock('../api/checkerAssignmentsApi', () => ({
  checkerAssignmentsApi: checkerApi,
}))

vi.mock('../../settings-applications/api/remoteAppsApi', () => ({
  remoteAppsApi,
}))

const { CheckerAssignmentPage } = await import('./CheckerAssignmentPage')

describe('CheckerAssignmentPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsDrawerStore.getState().close()
    useAuthStore.setState({
      accessToken: 'test-token',
      accessTokenExpiresAt: Date.now() + 3600_000,
      user: {
        id: 'admin-1',
        name: 'Admin User',
        email: 'admin@example.com',
        roleId: 'role-admin',
        isAdministrator: true,
      },
    })

    checkerApi.listModules.mockResolvedValue([
      { key: 'host.settings.users', label: 'User Directory' },
      { key: 'remote.lead.create', label: 'Create Lead' },
    ] satisfies AssignableModuleDto[])

    checkerApi.list.mockResolvedValue([
      {
        id: 'ca1',
        module: 'host.settings.users',
        checkerUserId: 'u1',
        checkerRoleId: null,
        checkerName: 'Supervisor Jane',
        isRole: false,
        memberCount: null,
        createdAt: '2026-01-15T09:00:00Z',
        alreadyAssigned: false,
      },
    ] satisfies CheckerAssignmentDto[])

    remoteAppsApi.list.mockResolvedValue({
      items: [
        {
          id: 'app1',
          key: 'lead',
          displayName: 'Lead MF',
          iconKey: 'Layers',
          manifestUrl: 'http://localhost:5001/remoteEntry.js',
          sidebarOrder: 1,
          status: 'Active',
          maintenanceMessage: null,
          permissionFeatureKey: 'remote.lead',
          permissionsSourceUrl: null,
          createdAt: '2026-01-10T08:00:00Z',
          updatedAt: '2026-01-10T08:00:00Z',
        },
      ],
      total: 1,
    })
  })

  it('renders PageHeader, KPI cards, and grouped modules', async () => {
    renderWithQuery(<CheckerAssignmentPage />, { route: '/settings/checker-assignment' })

    expect(screen.getByRole('heading', { name: 'Checker Assignment' })).toBeInTheDocument()
    expect(
      screen.getByText('Configure Maker-Checker governance rules and assign checkers to sensitive modules.'),
    ).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.getByText('Host Platform (Core)')).toBeInTheDocument()
      expect(screen.getByText('User Directory')).toBeInTheDocument()
      expect(screen.getByText('Supervisor Jane')).toBeInTheDocument()
    })

    expect(screen.getByText('Total Modules')).toBeInTheDocument()
    expect(screen.getByText('Gated Modules')).toBeInTheDocument()
    expect(screen.getByText('Ungated Modules')).toBeInTheDocument()
    expect(screen.getByText('Active Checkers')).toBeInTheDocument()
  })

  it('triggers drawer layer when clicking Assign Checker', async () => {
    renderWithQuery(<CheckerAssignmentPage />, { route: '/settings/checker-assignment' })

    const addBtn = screen.getByRole('button', { name: /assign checker/i })
    addBtn.click()

    await waitFor(() => {
      const state = useSettingsDrawerStore.getState()
      expect(state.layerStack.at(-1)?.type).toBe('checker-assignment-form')
    })
  })

  it('triggers drawer layer with appId when clicking Assign to Whole App', async () => {
    renderWithQuery(<CheckerAssignmentPage />, { route: '/settings/checker-assignment' })

    await waitFor(() => {
      expect(screen.getAllByText('Assign to Whole App').length).toBeGreaterThan(0)
    })

    const wholeAppBtn = screen.getAllByText('Assign to Whole App')[0].closest('button')!
    fireEvent.click(wholeAppBtn)

    await waitFor(() => {
      const state = useSettingsDrawerStore.getState()
      expect(state.layerStack.at(-1)?.type).toBe('checker-assignment-form')
      expect((state.layerStack.at(-1) as any)?.appId).toBeDefined()
    })
  })
})
