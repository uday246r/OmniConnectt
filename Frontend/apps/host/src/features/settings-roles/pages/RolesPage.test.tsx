import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '../../../test/renderWithQuery'
import { useAuthStore } from '../../auth/store/authStore'
import { useSettingsDrawerStore } from '../../../shared/stores/settingsDrawerStore'
import type { RoleListItemDto } from '../api/rolesApi'

const api = vi.hoisted(() => ({
  list: vi.fn(),
  get: vi.fn(),
  create: vi.fn(),
  update: vi.fn(),
  remove: vi.fn(),
  users: vi.fn(),
}))

vi.mock('../api/rolesApi', () => ({
  rolesApi: api,
}))

const { RolesPage } = await import('./RolesPage')

function mockRole(over: Partial<RoleListItemDto> = {}): RoleListItemDto {
  return {
    id: crypto.randomUUID(),
    name: 'Compliance Officer',
    description: 'Handles regulatory reporting',
    isSystemRole: false,
    isAdministrator: false,
    usersCount: 5,
    permissionsCount: 12,
    createdAt: '2026-01-15T10:00:00Z',
    ...over,
  }
}

describe('RolesPage', () => {
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
        mockRole({ id: 'r1', name: 'Super Admin', isAdministrator: true, isSystemRole: true }),
        mockRole({ id: 'r2', name: 'Compliance Officer', isAdministrator: false, isSystemRole: false }),
      ],
      total: 2,
      page: 1,
      pageSize: 10,
    })
  })

  it('renders PageHeader, KPI cards, and roles table', async () => {
    renderWithQuery(<RolesPage />, { route: '/settings/roles' })

    expect(screen.getByRole('heading', { name: 'Roles & Permissions' })).toBeInTheDocument()
    expect(
      screen.getByText('Define roles and configure granular permissions across platform features.'),
    ).toBeInTheDocument()

    // Table rows
    await waitFor(() => {
      expect(screen.getByText('Super Admin')).toBeInTheDocument()
      expect(screen.getByText('Compliance Officer')).toBeInTheDocument()
    })

    expect(screen.getByText('Total Roles')).toBeInTheDocument()
    expect(screen.getByText('System Roles')).toBeInTheDocument()
    expect(screen.getByText('Custom Roles')).toBeInTheDocument()
    expect(screen.getByText('Administrators')).toBeInTheDocument()
  })

  it('triggers drawer layer when clicking Add Role', async () => {
    renderWithQuery(<RolesPage />, { route: '/settings/roles' })

    const addBtn = screen.getByRole('button', { name: /add role/i })
    addBtn.click()

    await waitFor(() => {
      const state = useSettingsDrawerStore.getState()
      expect(state.layerStack.at(-1)?.type).toBe('role-form')
    })
  })
})
