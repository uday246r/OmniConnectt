import { Routes, Route } from 'react-router-dom'
import { screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '../../../test/renderWithQuery'
import { useAuthStore } from '../../auth/store/authStore'
import type { UserDetailDto } from '../api/usersApi'

const mockUsersApi = vi.hoisted(() => ({
  get: vi.fn(),
  updateStatus: vi.fn(),
  remove: vi.fn(),
}))

const mockUserSchemaApi = vi.hoisted(() => ({
  get: vi.fn(),
}))

const mockRolesApi = vi.hoisted(() => ({
  get: vi.fn(),
}))

const mockFieldSectionsApi = vi.hoisted(() => ({
  get: vi.fn(),
}))

vi.mock('../api/usersApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/usersApi')>()),
  usersApi: mockUsersApi,
}))

vi.mock('../../settings-user-fields/api/userSchemaApi', () => ({
  userSchemaApi: mockUserSchemaApi,
}))

vi.mock('../../settings-user-fields/api/fieldSectionsApi', () => ({
  fieldSectionsApi: mockFieldSectionsApi,
}))

vi.mock('../../settings-roles/api/rolesApi', () => ({
  rolesApi: mockRolesApi,
}))

const { UserDetailPage } = await import('./UserDetailPage')

function mockDetail(over: Partial<UserDetailDto> = {}): UserDetailDto {
  return {
    id: 'u-123',
    salutation: 'Mr.',
    name: 'John Doe',
    email: 'john.doe@example.com',
    phoneNumber: '+1 555-0199',
    roleId: 'r-analyst',
    roleName: 'Analyst',
    isAdministrator: false,
    isActive: true,
    lastLoginAt: '2026-09-28T10:00:00Z',
    authProvider: 'Local',
    awaitingPasswordSetup: false,
    mustChangePassword: false,
    createdAt: '2026-09-01T08:00:00Z',
    updatedAt: '2026-09-28T10:00:00Z',
    permissionOverrides: [],
    customFields: {
      department: 'Finance',
      country: 'United States',
      city: 'New York',
    },
    passwordChangedAt: '2026-09-01T08:00:00Z',
    passwordExpiresAt: '2026-11-30T08:00:00Z',
    isPasswordExpired: false,
    ...over,
  }
}

function renderPage(userId = 'u-123') {
  return renderWithQuery(
    <Routes>
      <Route path="/settings/users/:id" element={<UserDetailPage />} />
    </Routes>,
    { route: `/settings/users/${userId}` },
  )
}

describe('UserDetailPage - Section-Wise Details and Password Policy', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    useAuthStore.setState({
      status: 'authenticated',
      accessToken: 'test-token',
      accessTokenExpiresAt: Date.now() + 3600_000,
      user: {
        id: 'u-admin',
        name: 'Admin User',
        email: 'admin@example.com',
        roleName: 'Administrator',
        isAdministrator: true,
        permissions: [],
      } as any,
    })

    mockUserSchemaApi.get.mockResolvedValue({
      fields: [
        { key: 'name', label: 'Full Name', core: true, dataType: 'text', required: true, order: 1 },
        { key: 'email', label: 'Email', core: true, dataType: 'email', required: true, order: 2 },
        { key: 'phoneNumber', label: 'Phone', core: true, dataType: 'text', required: false, order: 3 },
        {
          key: 'department',
          label: 'Department',
          core: false,
          dataType: 'text',
          required: false,
          order: 4,
          section: 'Personal Details',
        },
        {
          key: 'country',
          label: 'Country',
          core: false,
          dataType: 'dropdown',
          required: false,
          order: 5,
          section: 'Address',
          template: 'contact-country',
        },
        {
          key: 'city',
          label: 'City',
          core: false,
          dataType: 'dropdown',
          required: false,
          order: 6,
          section: 'Address',
          template: 'contact-city',
        },
      ],
      version: 1,
      updatedAt: new Date().toISOString(),
    })

    mockFieldSectionsApi.get.mockResolvedValue({
      sections: [
        { key: 'personal-details', label: 'Personal Details', order: 1, isSystem: true },
        { key: 'address', label: 'Address', order: 2, isSystem: false },
      ],
      version: 1,
      updatedAt: new Date().toISOString(),
    })

    mockRolesApi.get.mockResolvedValue({
      id: 'r-analyst',
      name: 'Analyst',
      isAdministrator: false,
      permissions: [],
    })
  })

  it('renders user details grouped into Personal Details, Address, Password Policy, and Access', async () => {
    mockUsersApi.get.mockResolvedValue(mockDetail())

    renderPage('u-123')

    await waitFor(() => {
      expect(screen.getByText('Personal Details')).toBeInTheDocument()
      expect(screen.getByText('Address')).toBeInTheDocument()
      expect(screen.getByText('Password Policy')).toBeInTheDocument()
      expect(screen.getByText('Access')).toBeInTheDocument()
    })

    // Personal details verification
    expect(screen.getByText('John Doe')).toBeInTheDocument()
    expect(screen.getAllByText('john.doe@example.com')[0]).toBeInTheDocument()
    expect(screen.getByText('Finance')).toBeInTheDocument()

    // Address section verification
    expect(screen.getByText('United States')).toBeInTheDocument()
    expect(screen.getByText('New York')).toBeInTheDocument()

    // Password section verification — status and dates come from the global/role policy, not a template
    expect(screen.queryByText('Policy Template')).not.toBeInTheDocument()
    expect(screen.getAllByText('Active').length).toBeGreaterThanOrEqual(1)
  })

  it('displays Expired badge when user password has expired', async () => {
    mockUsersApi.get.mockResolvedValue(
      mockDetail({
        isPasswordExpired: true,
        mustChangePassword: true,
      }),
    )

    renderPage('u-123')

    await waitFor(() => {
      expect(screen.getByText('Password Policy')).toBeInTheDocument()
    })

    expect(screen.getByText(/Expired \(Must change on next login\)/i)).toBeInTheDocument()
  })

  it('follows the section catalog: a renamed section shows its new label with its fields inside it', async () => {
    mockFieldSectionsApi.get.mockResolvedValue({
      sections: [
        { key: 'personal-details', label: 'Personal Details', order: 1, isSystem: true },
        { key: 'address', label: 'Contact & Address', order: 2, isSystem: false },
      ],
      version: 2,
      updatedAt: new Date().toISOString(),
    })
    mockUsersApi.get.mockResolvedValue(mockDetail())

    renderPage('u-123')

    expect(await screen.findByText('Contact & Address')).toBeInTheDocument()
    expect(screen.getByText('New York')).toBeInTheDocument()
  })

  it('omits a section that holds none of the fields, other than the default one', async () => {
    mockFieldSectionsApi.get.mockResolvedValue({
      sections: [
        { key: 'personal-details', label: 'Personal Details', order: 1, isSystem: true },
        { key: 'address', label: 'Address', order: 2, isSystem: false },
        { key: 'bank', label: 'Bank Details', order: 3, isSystem: false },
      ],
      version: 1,
      updatedAt: new Date().toISOString(),
    })
    mockUsersApi.get.mockResolvedValue(mockDetail())

    renderPage('u-123')

    await screen.findByText('Address')
    expect(screen.queryByText('Bank Details')).not.toBeInTheDocument()
  })

  it('still shows the user their data when the section catalog cannot be loaded', async () => {
    mockFieldSectionsApi.get.mockRejectedValue(new Error('down'))
    mockUsersApi.get.mockResolvedValue(mockDetail())

    renderPage('u-123')

    // Degrades to one default section rather than hiding the values — this page never writes the schema.
    expect(await screen.findByText('Finance')).toBeInTheDocument()
    expect(screen.getByText('New York')).toBeInTheDocument()
  })
})
