import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithQuery } from '../../../test/renderWithQuery'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../../auth/store/authStore'
import { ApiError } from '../../../shared/api/httpClient'
import type { ApprovalRequestListItemDto } from '../api/approvalsApi'

/**
 * The maker's side of Maker-Checker, and the one place a one-time secret is handed over.
 *
 * Approving a Create-User generates a temporary password that the server stores encrypted for the
 * maker to collect exactly once. The page's job is narrow but unforgiving: fetch the maker's own
 * requests by status, show "Get password" only while there is one to collect, show it once, and tell
 * a genuinely spent password (410) apart from a transient failure — the latter must leave the button
 * in place, or a dropped connection permanently hides the only way to retrieve the credential.
 */

const api = vi.hoisted(() => ({
  listMine: vi.fn(),
  mineFacets: vi.fn(),
  revealTempPassword: vi.fn(),
}))

vi.mock('../api/approvalsApi', () => ({ approvalsApi: api }))

const { MyRequestsPage } = await import('./MyRequestsPage')

function item(over: Partial<ApprovalRequestListItemDto> = {}): ApprovalRequestListItemDto {
  return {
    id: 'req-1',
    module: 'host.settings.users',
    action: 'Create',
    entityType: 'User',
    entityLabel: 'new.hire@example.com',
    status: 'Approved',
    makerId: 'me',
    makerName: 'Asha Rao',
    checkerId: 'checker',
    checkerName: 'Ben Ito',
    requestedAt: '2026-09-12T09:00:00Z',
    decidedAt: '2026-09-12T10:00:00Z',
    rejectionReason: null,
    hasTempPassword: true,
    ...over,
  }
}

function renderPage() {
  return renderWithQuery(<MyRequestsPage />)
}

beforeEach(() => {
  vi.clearAllMocks()
  api.listMine.mockResolvedValue({ items: [item()], total: 1, page: 1, pageSize: 10 })
  api.mineFacets.mockResolvedValue({ modules: ['host.settings.users', 'remote.lead.lead'], actions: ['Create', 'Delete'], makers: [], checkers: ['Ben Ito', 'Chen Li'] })
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'token',
    user: { id: 'me', name: 'Asha Rao', email: 'asha@example.com', isAdministrator: false, permissions: [] } as never,
  })
})

describe('listing the maker’s own requests', () => {
  it('asks the server for the chosen status rather than filtering what it already has', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('new.hire@example.com')

    await user.click(screen.getByRole('tab', { name: 'Rejected' }))

    await waitFor(() =>
      expect(api.listMine.mock.calls.at(-1)?.[1]).toMatchObject({ status: 'Rejected', page: 1 }),
    )
  })

  it('sends no status for All', async () => {
    renderPage()

    await waitFor(() => expect(api.listMine).toHaveBeenCalled())

    expect(api.listMine.mock.calls[0][1]).toMatchObject({ status: undefined })
  })
})

describe('collecting the temporary password', () => {
  it('shows it once, then removes the button', async () => {
    api.revealTempPassword.mockResolvedValue({ temporaryPassword: 'Tmp#9fQ2xL', userName: 'New Hire', userEmail: 'new.hire@example.com' })
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /get password/i }))

    expect(await screen.findByText('Tmp#9fQ2xL')).toBeInTheDocument()
    expect(api.revealTempPassword).toHaveBeenCalledWith('token', 'req-1')
    expect(screen.queryByRole('button', { name: /get password/i })).not.toBeInTheDocument()
  })

  it('offers nothing to collect on a request without a stored password', async () => {
    api.listMine.mockResolvedValue({ items: [item({ hasTempPassword: false })], total: 1, page: 1, pageSize: 10 })
    renderPage()
    await screen.findByText('new.hire@example.com')

    expect(screen.queryByRole('button', { name: /get password/i })).not.toBeInTheDocument()
  })

  it('hides the button when the server says the password is already gone', async () => {
    api.revealTempPassword.mockRejectedValue(new ApiError(410, 'This temporary password has already been viewed.'))
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /get password/i }))

    expect(await screen.findByText('This temporary password has already been viewed.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /get password/i })).not.toBeInTheDocument()
  })

  it('keeps the button after a transient failure so the maker can try again', async () => {
    api.revealTempPassword.mockRejectedValue(new ApiError(503, 'Service unavailable'))
    const user = userEvent.setup()
    renderPage()

    await user.click(await screen.findByRole('button', { name: /get password/i }))

    expect(await screen.findByText('Service unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /get password/i })).toBeEnabled()
  })
})

describe('filtering', () => {
  it('asks the server for module, action and checker instead of narrowing the page it has', async () => {
    renderPage()
    await screen.findByText('new.hire@example.com')

    await userEvent.click(screen.getByRole('button', { name: 'Action' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(api.listMine.mock.calls.at(-1)?.[1]).toMatchObject({ action: 'Delete', page: 1 }))
    expect(api.mineFacets.mock.calls.at(-1)?.[1]).toMatchObject({ action: 'Delete' })
  })

  it('offers dropdown options from all of the maker’s requests, not only the page on screen', async () => {
    renderPage()
    await screen.findByText('new.hire@example.com')

    await userEvent.click(screen.getByRole('button', { name: 'Checker' }))

    expect(await screen.findByRole('button', { name: 'Chen Li' })).toBeInTheDocument()
  })
})
