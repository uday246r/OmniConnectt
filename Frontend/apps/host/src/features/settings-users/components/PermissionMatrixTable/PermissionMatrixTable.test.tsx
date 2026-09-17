import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { PermissionMatrixTable } from './PermissionMatrixTable'
import type { PermissionFeatureDto } from '../../../../shared/api/permissionsApi'
import type { HealthEntryDto } from '../../../settings-applications/api/remoteAppsApi'

const MOCK_CATALOG: PermissionFeatureDto[] = [
  {
    featureKey: 'host.settings.users',
    name: 'User Management',
    description: 'Manage platform users',
    category: 'Administration',
    capabilities: [
      { capabilityKey: 'View', name: 'View Users', description: 'Browse user directory' },
      { capabilityKey: 'Create', name: 'Create User', description: 'Add new users' },
      { capabilityKey: 'Edit', name: 'Edit User', description: 'Modify users' },
    ],
  },
  {
    featureKey: 'host.system.audit-logs',
    name: 'Audit Logs',
    description: 'Security audit trail',
    category: 'System',
    capabilities: [
      { capabilityKey: 'View', name: 'View Audit Logs', description: 'Browse audit logs' },
      { capabilityKey: 'Export', name: 'Export Audit Logs', description: 'Download CSV reports' },
    ],
  },
]

const MOCK_REGISTRY: HealthEntryDto[] = []

describe('PermissionMatrixTable', () => {
  it('renders administrator privileges banner and modules when isAdministrator is true', () => {
    render(
      <PermissionMatrixTable
        permissions={[]}
        catalog={MOCK_CATALOG}
        registryApps={MOCK_REGISTRY}
        isAdministrator={true}
        roleName="Super Administrator"
      />,
    )

    expect(screen.getByText('Super Administrator Privileges')).toBeInTheDocument()
    expect(screen.getByText('Host Platform')).toBeInTheDocument()
    expect(screen.getByText('User Management')).toBeInTheDocument()
    expect(screen.getByText('Unrestricted')).toBeInTheDocument()
  })

  it('renders grouped application cards and modules for a standard user', () => {
    const permissions = [
      'host.settings.users:View',
      'host.settings.users:Create',
      'host.system.audit-logs:View',
    ]

    render(
      <PermissionMatrixTable
        permissions={permissions}
        catalog={MOCK_CATALOG}
        registryApps={MOCK_REGISTRY}
        isAdministrator={false}
        roleName="Auditor"
      />,
    )

    expect(screen.getByText('Host Platform')).toBeInTheDocument()
    expect(screen.getByText('3 Permissions')).toBeInTheDocument()
    expect(screen.getByText('Auditor')).toBeInTheDocument()

    // Verbs rendered as badges
    expect(screen.getAllByText('View').length).toBeGreaterThan(0)
    expect(screen.getByText('Create')).toBeInTheDocument()
  })

  it('filters modules when searching', () => {
    const permissions = [
      'host.settings.users:View',
      'host.system.audit-logs:Export',
    ]

    render(
      <PermissionMatrixTable
        permissions={permissions}
        catalog={MOCK_CATALOG}
        registryApps={MOCK_REGISTRY}
        isAdministrator={false}
      />,
    )

    const searchInput = screen.getByPlaceholderText(/search modules or actions/i)
    fireEvent.change(searchInput, { target: { value: 'Export' } })

    expect(screen.getByText('Export')).toBeInTheDocument()
  })

  it('renders standard role access notice when permissions list is empty', () => {
    render(
      <PermissionMatrixTable
        permissions={[]}
        catalog={MOCK_CATALOG}
        registryApps={MOCK_REGISTRY}
        isAdministrator={false}
        roleName="Standard User"
      />,
    )

    expect(screen.getByText('Standard Role Access')).toBeInTheDocument()
  })
})
