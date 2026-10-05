import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { RequirePasswordChange } from './RequirePasswordChange'
import { useAuthStore } from '../store/authStore'
import { authServiceClient } from '../../../shared/api/authServiceClient'

/**
 * The gate an expired (or temporary-password) account cannot get past. The form itself is stubbed — it
 * has its own tests — so what is pinned here is the decision layer: which words the user sees, whether
 * the emailed-link escape hatch is offered, and that it can only be pressed once at a time.
 */

vi.mock('../../profile/components/ChangePasswordForm', () => ({
  ChangePasswordForm: ({ submitLabel }: { submitLabel?: string }) => <button type="button">{submitLabel}</button>,
}))

vi.mock('../../../shared/api/authServiceClient', () => ({
  authServiceClient: { forgotPassword: vi.fn() },
}))

const mockForgot = vi.mocked(authServiceClient.forgotPassword)

function signInAs(over: Record<string, unknown>) {
  // The real loader hits the network and, failing, signs the user out mid-test.
  useAuthStore.setState({ loadFineCapabilities: () => Promise.resolve() })
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'test-token',
    accessTokenExpiresAt: Date.now() + 3600_000,
    user: {
      id: 'u1', name: 'Jane', email: 'jane@example.com', roleName: 'Analyst', isAdministrator: false,
      permissions: [], authProvider: 'Local', isActive: true, mustChangePassword: true, ...over,
    } as never,
  })
}

const renderGate = () => render(
  <MemoryRouter>
    <RequirePasswordChange><div>the app</div></RequirePasswordChange>
  </MemoryRouter>,
)

beforeEach(() => {
  vi.clearAllMocks()
  mockForgot.mockResolvedValue({ message: 'ok' })
})

describe('when nothing is required', () => {
  it('renders the application untouched', () => {
    signInAs({ mustChangePassword: false })

    renderGate()

    expect(screen.getByText('the app')).toBeInTheDocument()
  })
})

describe('an expired password', () => {
  const expired = { passwordExpiry: { expiresAt: '2026-09-01T00:00:00Z', daysRemaining: 0, isExpired: true, showReminder: false } }

  it('says the password has expired and never renders the app behind it', () => {
    signInAs(expired)

    renderGate()

    expect(screen.getByRole('heading', { name: /your password has expired/i })).toBeInTheDocument()
    expect(screen.queryByText('the app')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set a new password' })).toBeInTheDocument()
  })

  it('offers an emailed reset link for someone who no longer remembers the old password', () => {
    signInAs(expired)

    renderGate()

    expect(screen.getByRole('button', { name: /email me a reset link/i })).toBeInTheDocument()
  })

  it('emails the link to the signed-in address exactly once and then confirms', async () => {
    const user = userEvent.setup()
    signInAs(expired)
    renderGate()

    await user.click(screen.getByRole('button', { name: /email me a reset link/i }))

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('jane@example.com'))
    expect(mockForgot).toHaveBeenCalledTimes(1)
    expect(mockForgot).toHaveBeenCalledWith('jane@example.com')
    expect(screen.queryByRole('button', { name: /email me a reset link/i })).not.toBeInTheDocument()
  })

  it('tells the user when the email could not be requested, and lets them try again', async () => {
    const user = userEvent.setup()
    mockForgot.mockRejectedValueOnce(new Error('rate limited'))
    signInAs(expired)
    renderGate()

    await user.click(screen.getByRole('button', { name: /email me a reset link/i }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/couldn't send/i)
    expect(screen.getByRole('button', { name: /email me a reset link/i })).toBeInTheDocument()
  })

  it('does not offer an emailed link to a Google account, which has no OmniConnect password to reset', () => {
    signInAs({ ...expired, authProvider: 'Google' })

    renderGate()

    expect(screen.queryByRole('button', { name: /email me a reset link/i })).not.toBeInTheDocument()
  })
})

describe('a temporary password', () => {
  it('keeps its own wording and does not offer the emailed link', () => {
    signInAs({ passwordExpiry: { expiresAt: null, daysRemaining: null, isExpired: false, showReminder: false } })

    renderGate()

    expect(screen.getByRole('heading', { name: /choose your password/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Set my password' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /email me a reset link/i })).not.toBeInTheDocument()
  })

  it('still works for a session that predates the expiry field being sent', () => {
    signInAs({})

    renderGate()

    expect(screen.getByRole('heading', { name: /choose your password/i })).toBeInTheDocument()
  })
})

describe('leaving', () => {
  it('always offers Sign out instead', () => {
    signInAs({ passwordExpiry: { expiresAt: null, daysRemaining: 0, isExpired: true, showReminder: false } })

    renderGate()

    expect(screen.getByRole('button', { name: /sign out instead/i })).toBeInTheDocument()
  })
})
