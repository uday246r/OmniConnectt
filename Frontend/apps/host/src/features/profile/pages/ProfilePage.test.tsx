import { act, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '../../../test/renderWithQuery'
import { useAuthStore } from '../../auth/store/authStore'

/**
 * The profile page renders nothing until a user is known, and it stays mounted across sign-out. A hook
 * declared after that early return ran on some renders and not on others, so the user arriving (or
 * leaving) while the page was mounted made React throw "Rendered more hooks than during the previous
 * render" and blanked the shell. These tests pin the page surviving both transitions.
 */

vi.mock('../../settings-user-fields/api/salutationsApi', () => ({
  salutationsApi: { get: vi.fn().mockResolvedValue({ salutations: [] }) },
}))

vi.mock('../../settings-users/hooks/usePermissionCatalog', () => ({
  usePermissionCatalog: () => ({ catalog: null, loading: false, error: null }),
}))

const { ProfilePage } = await import('./ProfilePage')

const user = {
  id: 'u-1',
  name: 'Asha Rao',
  email: 'asha@example.com',
  isAdministrator: false,
  permissions: [],
  roleName: 'Lead Officer',
}

afterEach(() => {
  useAuthStore.setState({ status: 'idle', accessToken: null, user: null, fineCapabilities: [] } as never)
})

describe('ProfilePage', () => {
  it('renders once the signed-in user arrives after the page has mounted', () => {
    useAuthStore.setState({ status: 'loading', accessToken: null, user: null } as never)
    renderWithQuery(<ProfilePage />)

    act(() => {
      useAuthStore.setState({ status: 'authenticated', accessToken: 'token', user } as never)
    })

    expect(screen.getByRole('heading', { name: 'User Profile' })).toBeInTheDocument()
  })

  it('renders nothing, without throwing, when the user signs out while the page is mounted', () => {
    useAuthStore.setState({ status: 'authenticated', accessToken: 'token', user } as never)
    renderWithQuery(<ProfilePage />)
    expect(screen.getByRole('heading', { name: 'User Profile' })).toBeInTheDocument()

    act(() => {
      useAuthStore.setState({ status: 'idle', accessToken: null, user: null } as never)
    })

    expect(screen.queryByRole('heading', { name: 'User Profile' })).not.toBeInTheDocument()
  })
})
