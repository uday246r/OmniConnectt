import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { renderWithQuery } from '../../../test/renderWithQuery'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../../auth/store/authStore'
import type { ApprovalRequestListItemDto } from '../api/approvalsApi'

/**
 * The maker's side of Maker-Checker.
 *
 * Every narrowing on this page — the status tabs and each dropdown — has to reach the server rather
 * than filter the page already in hand, because the page is one page of many: a client-side filter
 * silently answers from a tenth of the data and looks like it worked. These tests pin that by
 * asserting on the request the page makes, not on the rows it happens to render.
 *
 * This page used to also hand over a one-time temporary password for approved Create-User requests.
 * That mechanism is gone — a new account is emailed a set-password link instead — so there is no
 * secret on this screen to test any more.
 */

const api = vi.hoisted(() => ({
  listMine: vi.fn(),
  mineFacets: vi.fn(),
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

describe('an approved Create-User request', () => {
  it('offers no credential to collect — the new account is emailed a set-password link instead', async () => {
    renderPage()
    await screen.findByText('new.hire@example.com')

    expect(screen.queryByRole('button', { name: /password/i })).not.toBeInTheDocument()
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
