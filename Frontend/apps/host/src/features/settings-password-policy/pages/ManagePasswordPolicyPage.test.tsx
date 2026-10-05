import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { ManagePasswordPolicyPage } from './ManagePasswordPolicyPage'
import { useAuthStore } from '../../auth/store/authStore'
import { ApiError } from '../../../shared/api/httpClient'
import type { PasswordPolicyCatalogDto } from '../api/passwordPolicyApi'

/**
 * The screen an administrator uses to decide how long every credential on the platform lives. The
 * flows worth pinning are the ones with a security consequence: an empty expiry box must never save as
 * 0 ("never expires"), a blank role row must send NO row (inherit) rather than a 0, the version the
 * page loaded must travel with the save, and someone without Edit must not be able to change anything.
 *
 * The page also opens read-only, so every test that changes something goes through `beginEditing`
 * first — the same step a real administrator takes, and the reason a stray click on a number input
 * can no longer alter the policy for everyone.
 */

const mockApi = vi.hoisted(() => ({ get: vi.fn(), update: vi.fn() }))
vi.mock('../api/passwordPolicyApi', () => ({ passwordPolicyApi: mockApi }))

const catalog = (over: Partial<PasswordPolicyCatalogDto> = {}): PasswordPolicyCatalogDto => ({
  version: 4,
  updatedAt: new Date().toISOString(),
  policy: {
    expiryDays: 90,
    roleExpiries: [{ roleId: 'r-treasury', expiryDays: 30 }],
    complexity: {
      minimumLength: 12, maximumLength: 128, requireUppercase: true, requireLowercase: true,
      requireDigit: true, requireNonAlphanumeric: true, rejectSameAsCurrent: true,
    },
    notifications: { email: true, inApp: true, leadDays: [14, 7, 3, 1] },
  },
  roles: [
    { id: 'r-treasury', name: 'Treasury', userCount: 3 },
    { id: 'r-analyst', name: 'Analyst', userCount: 12 },
  ],
  ...over,
})

function signInAs(admin: boolean) {
  useAuthStore.setState({ loadFineCapabilities: () => Promise.resolve() })
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'test-token',
    accessTokenExpiresAt: Date.now() + 3600_000,
    user: admin
      ? ({ id: 'u1', name: 'Admin', email: 'a@x.com', roleName: 'Administrator', isAdministrator: true, permissions: [] } as never)
      : ({ id: 'u2', name: 'Viewer', email: 'v@x.com', roleName: 'Auditor', isAdministrator: false, permissions: [] } as never),
    fineCapabilities: [],
  })
}

type User = ReturnType<typeof userEvent.setup>

const expiryInput = () => screen.getByLabelText(/passwords expire after/i)

/** Turns the live controls on, the way an administrator does. */
async function beginEditing(user: User) {
  await user.click(screen.getByRole('button', { name: /^edit$/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  signInAs(true)
  mockApi.get.mockResolvedValue(catalog())
  mockApi.update.mockImplementation(async (_t: string, body: { policy: PasswordPolicyCatalogDto['policy'] }) =>
    catalog({ policy: body.policy, version: 5 }))
})

describe('loading', () => {
  it('shows the saved policy in the summary and the form', async () => {
    render(<ManagePasswordPolicyPage />)

    expect(await screen.findByDisplayValue('90')).toBeInTheDocument()
    expect(screen.getByText('90 days')).toBeInTheDocument()
    expect(screen.getByText('1 of 2')).toBeInTheDocument()
    expect(screen.getByText('14 / 7 / 3 / 1 days before')).toBeInTheDocument()
  })

  it('reports a load failure with a way to retry instead of an empty form', async () => {
    mockApi.get.mockRejectedValueOnce(new ApiError(500, 'down'))

    render(<ManagePasswordPolicyPage />)

    expect(await screen.findByRole('alert')).toHaveTextContent('down')
    expect(screen.getByRole('button', { name: /reload/i })).toBeInTheDocument()
  })
})

/*
 * The guard this page exists behind, now that it has one. Every control used to be live on arrival, so
 * looking the policy up and changing it were the same gesture.
 */
describe('edit mode', () => {
  it('opens read-only even for an administrator, and offers Edit', async () => {
    render(<ManagePasswordPolicyPage />)
    await screen.findByDisplayValue('90')

    expect(expiryInput()).toBeDisabled()
    expect(screen.getByRole('switch', { name: /require a symbol/i })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /add reminder/i })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /remove reminder/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
  })

  it('makes the controls live once Edit is pressed, and says so', async () => {
    const user = userEvent.setup()
    render(<ManagePasswordPolicyPage />)
    await screen.findByDisplayValue('90')

    await beginEditing(user)

    expect(expiryInput()).toBeEnabled()
    expect(screen.getByRole('switch', { name: /require a symbol/i })).toBeEnabled()
    expect(screen.getByRole('region', { name: /password policy actions/i })).toBeInTheDocument()
    // Nothing has changed yet, so there is nothing to save.
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
  })

  it('goes back to read-only after a save, with the new value shown', async () => {
    const user = userEvent.setup()
    render(<ManagePasswordPolicyPage />)
    await screen.findByDisplayValue('90')

    await beginEditing(user)
    await user.clear(expiryInput())
    await user.type(expiryInput(), '60')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument())
    expect(expiryInput()).toBeDisabled()
    expect(screen.getByText('60 days')).toBeInTheDocument()
  })
})

describe('global policy', () => {
  it('offers Save only once something has changed', async () => {
    const user = userEvent.setup()
    render(<ManagePasswordPolicyPage />)
    await screen.findByDisplayValue('90')

    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument()

    await beginEditing(user)
    expect(screen.getByRole('button', { name: /save changes/i })).toBeDisabled()

    await user.clear(expiryInput())
    await user.type(expiryInput(), '60')

    expect(screen.getByRole('button', { name: /save changes/i })).toBeEnabled()
  })

  it('sends the edited lifetime along with the version it loaded', async () => {
    const user = userEvent.setup()
    render(<ManagePasswordPolicyPage />)
    await screen.findByDisplayValue('90')

    await beginEditing(user)
    await user.clear(expiryInput())
    await user.type(expiryInput(), '60')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(mockApi.update).toHaveBeenCalledTimes(1))
    const [, body] = mockApi.update.mock.calls[0]
    expect(body.policy.expiryDays).toBe(60)
    expect(body.expectedVersion).toBe(4)
  })

  it('refuses to save an empty lifetime instead of quietly turning expiry off', async () => {
    const user = userEvent.setup()
    render(<ManagePasswordPolicyPage />)
    await screen.findByDisplayValue('90')

    await beginEditing(user)
    await user.clear(expiryInput())
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(await screen.findByText(/whole number from 0/i)).toBeInTheDocument()
    expect(mockApi.update).not.toHaveBeenCalled()
  })

  it('says plainly that reminders do nothing while passwords never expire', async () => {
    const user = userEvent.setup()
    render(<ManagePasswordPolicyPage />)
    await screen.findByDisplayValue('90')

    await beginEditing(user)
    await user.clear(expiryInput())
    await user.type(expiryInput(), '0')

    expect(screen.getByRole('status')).toHaveTextContent(/never expire.*no reminders/i)
  })

  it('updates the plain-English requirement summary as the toggles change', async () => {
    const user = userEvent.setup()
    render(<ManagePasswordPolicyPage />)
    await screen.findByDisplayValue('90')

    expect(screen.getByText(/at least 12 characters, an uppercase letter, a lowercase letter, a digit and a symbol/i)).toBeInTheDocument()

    await beginEditing(user)
    await user.click(screen.getByRole('switch', { name: /require a symbol/i }))

    expect(screen.getByText(/a lowercase letter and a digit\./i)).toBeInTheDocument()
  })
})

describe('reminders', () => {
  it('adds a reminder day, keeps the list largest-first, and refuses a duplicate', async () => {
    const user = userEvent.setup()
    render(<ManagePasswordPolicyPage />)
    await screen.findByDisplayValue('90')
    await beginEditing(user)

    await user.type(screen.getByLabelText('Days before expiry'), '10')
    await user.click(screen.getByRole('button', { name: /add reminder/i }))

    const chips = screen.getAllByRole('button', { name: /remove reminder/i }).map((b) => b.getAttribute('aria-label'))
    expect(chips[0]).toMatch(/14 days/)
    expect(chips[1]).toMatch(/10 days/)

    await user.type(screen.getByLabelText('Days before expiry'), '10')
    await user.click(screen.getByRole('button', { name: /add reminder/i }))
    expect(await screen.findByText(/already in the list/i)).toBeInTheDocument()
  })

  it('removes a reminder day', async () => {
    const user = userEvent.setup()
    render(<ManagePasswordPolicyPage />)
    await screen.findByDisplayValue('90')
    await beginEditing(user)

    await user.click(screen.getByRole('button', { name: /remove reminder 14 days/i }))

    expect(screen.queryByRole('button', { name: /remove reminder 14 days/i })).not.toBeInTheDocument()
  })

  it('will not accept a sixth reminder day', async () => {
    const user = userEvent.setup()
    mockApi.get.mockResolvedValue(catalog({
      policy: { ...catalog().policy, expiryDays: 365, notifications: { email: true, inApp: true, leadDays: [30, 21, 14, 7, 3] } },
    }))
    render(<ManagePasswordPolicyPage />)
    await screen.findByDisplayValue('365')
    await beginEditing(user)

    await user.type(screen.getByLabelText('Days before expiry'), '1')
    await user.click(screen.getByRole('button', { name: /add reminder/i }))

    expect(await screen.findByText(/at most 5/i)).toBeInTheDocument()
  })

  it('refuses to save a reminder that would fall on or after the expiry day', async () => {
    const user = userEvent.setup()
    render(<ManagePasswordPolicyPage />)
    await screen.findByDisplayValue('90')
    await beginEditing(user)

    await user.clear(expiryInput())
    await user.type(expiryInput(), '10') // widest reminder is 14 days
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(await screen.findByText(/sooner than the expiry/i)).toBeInTheDocument()
    expect(mockApi.update).not.toHaveBeenCalled()
  })
})

describe('role policies', () => {
  async function openRoles({ editing = true } = {}) {
    const user = userEvent.setup()
    render(<ManagePasswordPolicyPage />)
    await screen.findByDisplayValue('90')
    if (editing) await beginEditing(user)
    await user.click(screen.getByRole('tab', { name: /role policies/i }))
    return user
  }

  it('lists every role with its user count and what it currently resolves to', async () => {
    await openRoles({ editing: false })

    expect(screen.getByLabelText('Password lifetime for Treasury')).toHaveValue(30)
    expect(screen.getByText('Expires after 30 days')).toBeInTheDocument()
    expect(screen.getByLabelText('Password lifetime for Analyst')).toHaveValue(null)
    expect(screen.getByText('Inherits the global lifetime (90 days)')).toBeInTheDocument()
    expect(screen.getByTitle('12 active users')).toBeInTheDocument()
    // Read mode: the rows can be read but not retyped, and "Use global" is not on offer.
    expect(screen.getByLabelText('Password lifetime for Treasury')).toBeDisabled()
    expect(screen.queryByRole('button', { name: /use the global lifetime for treasury/i })).not.toBeInTheDocument()
  })

  it('gives a role its own lifetime and sends only the rows that have one', async () => {
    const user = await openRoles()

    await user.type(screen.getByLabelText('Password lifetime for Analyst'), '45')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(mockApi.update).toHaveBeenCalledTimes(1))
    expect(mockApi.update.mock.calls[0][1].policy.roleExpiries).toEqual(
      expect.arrayContaining([{ roleId: 'r-analyst', expiryDays: 45 }, { roleId: 'r-treasury', expiryDays: 30 }]),
    )
  })

  it('clearing a role back to blank drops its row so it inherits, rather than sending a 0', async () => {
    const user = await openRoles()

    await user.click(screen.getByRole('button', { name: /use the global lifetime for treasury/i }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(mockApi.update).toHaveBeenCalledTimes(1))
    expect(mockApi.update.mock.calls[0][1].policy.roleExpiries).toEqual([])
  })

  it('refuses 0 for a role because it would silently switch expiry off for everyone holding it', async () => {
    const user = await openRoles()

    const input = screen.getByLabelText('Password lifetime for Analyst')
    await user.type(input, '0')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(await screen.findByText(/1 to 3650 days/i)).toBeInTheDocument()
    expect(mockApi.update).not.toHaveBeenCalled()
  })

  it('jumps to the Role Policies tab when the only problem is on a role row', async () => {
    const user = userEvent.setup()
    render(<ManagePasswordPolicyPage />)
    await screen.findByDisplayValue('90')
    await beginEditing(user)
    await user.click(screen.getByRole('tab', { name: /role policies/i }))
    await user.type(screen.getByLabelText('Password lifetime for Analyst'), '0')
    await user.click(screen.getByRole('tab', { name: /global policy/i }))
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    expect(await screen.findByRole('tab', { name: /role policies/i, selected: true })).toBeInTheDocument()
  })
})

describe('saving', () => {
  it('shows the new version as saved and hides the save bar again', async () => {
    const user = userEvent.setup()
    render(<ManagePasswordPolicyPage />)
    await screen.findByDisplayValue('90')

    await beginEditing(user)
    await user.clear(expiryInput())
    await user.type(expiryInput(), '60')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    await waitFor(() => expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument())
    expect(screen.getByText('60 days')).toBeInTheDocument()
  })

  it('surfaces a concurrent-edit conflict and offers Reload rather than overwriting', async () => {
    const user = userEvent.setup()
    mockApi.update.mockRejectedValueOnce(new ApiError(409, 'Someone else changed the password policy'))
    render(<ManagePasswordPolicyPage />)
    await screen.findByDisplayValue('90')

    await beginEditing(user)
    await user.clear(expiryInput())
    await user.type(expiryInput(), '60')
    await user.click(screen.getByRole('button', { name: /save changes/i }))

    const banner = await screen.findByRole('alert')
    expect(within(banner).getByText(/someone else changed/i)).toBeInTheDocument()
    expect(within(banner).getByRole('button', { name: /reload/i })).toBeInTheDocument()
  })

  it('Cancel puts the edits back to the saved policy and leaves edit mode', async () => {
    const user = userEvent.setup()
    render(<ManagePasswordPolicyPage />)
    await screen.findByDisplayValue('90')

    await beginEditing(user)
    await user.clear(expiryInput())
    await user.type(expiryInput(), '60')
    await user.click(screen.getByRole('button', { name: /^cancel$/i }))

    expect(expiryInput()).toHaveValue(90)
    expect(expiryInput()).toBeDisabled()
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^edit$/i })).toBeInTheDocument()
  })
})

describe('read-only viewer', () => {
  beforeEach(() => signInAs(false))

  it('sees the policy but is not even offered Edit', async () => {
    const user = userEvent.setup()
    render(<ManagePasswordPolicyPage />)
    await screen.findByDisplayValue('90')

    expect(screen.queryByRole('button', { name: /^edit$/i })).not.toBeInTheDocument()
    expect(expiryInput()).toBeDisabled()
    expect(screen.getByRole('switch', { name: /require a symbol/i })).toBeDisabled()
    expect(screen.queryByRole('button', { name: /add reminder/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('tab', { name: /role policies/i }))
    expect(screen.getByLabelText('Password lifetime for Analyst')).toBeDisabled()
    expect(screen.queryByRole('button', { name: /save changes/i })).not.toBeInTheDocument()
  })
})
