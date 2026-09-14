import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../../auth/store/authStore'
import { ApiError } from '../../../shared/api/httpClient'
import type { ApprovalRequestDetailDto, ApprovalRequestListItemDto } from '../api/approvalsApi'

/**
 * The checker's screen: what they see, what they may decide, and what the decision sends.
 *
 * Two contracts are pinned. The queue is queried by the server — one request per page, every filter a
 * parameter — because the page used to pull 200 rows per status and filter the rest in the browser,
 * which made older requests unfindable and let the export disagree with the table. And the decision
 * controls follow the server's rules rather than inventing their own: only the assigned checker sees
 * them, and when the server refuses (self-approval, already decided) its message is what the checker
 * reads.
 */

const api = vi.hoisted(() => ({
  list: vi.fn(),
  facets: vi.fn(),
  summary: vi.fn(),
  get: vi.fn(),
  approve: vi.fn(),
  reject: vi.fn(),
  exportCsv: vi.fn(),
}))

vi.mock('../api/approvalsApi', () => ({ approvalsApi: api }))

const { ApprovalCenterPage } = await import('./ApprovalCenterPage')

const CHECKER_ID = 'checker-1'

function item(over: Partial<ApprovalRequestListItemDto> = {}): ApprovalRequestListItemDto {
  return {
    id: 'req-1',
    module: 'host.settings.users',
    action: 'Update',
    entityType: 'User',
    entityLabel: 'jane@example.com',
    status: 'Pending',
    makerId: 'maker-1',
    makerName: 'Asha Rao',
    checkerId: CHECKER_ID,
    checkerName: 'Ben Ito',
    requestedAt: '2026-09-12T09:00:00Z',
    decidedAt: null,
    rejectionReason: null,
    hasTempPassword: false,
    ...over,
  }
}

function detailOf(i: ApprovalRequestListItemDto, over: Partial<ApprovalRequestDetailDto> = {}): ApprovalRequestDetailDto {
  return { ...i, entityId: 'u-9', oldDataJson: '{"name":"Jane"}', newDataJson: '{"name":"Jane Doe"}', ...over }
}

function signInAs(id: string) {
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'token',
    user: { id, name: 'Ben Ito', email: 'ben@example.com', isAdministrator: true, permissions: [] } as never,
  })
}

function renderPage() {
  return render(
    <MemoryRouter>
      <ApprovalCenterPage />
    </MemoryRouter>,
  )
}

function lastParams(fn: ReturnType<typeof vi.fn>) {
  return fn.mock.calls.at(-1)?.[1] as Record<string, unknown>
}

async function openRequest(user: ReturnType<typeof userEvent.setup>) {
  const label = await screen.findByText('jane@example.com')
  const row = (label.closest('tr') ?? label.closest('[role="row"]')) as HTMLElement
  await user.click(within(row).getByRole('button', { name: /view/i }))
}

beforeEach(() => {
  vi.clearAllMocks()
  const pending = item()
  api.list.mockResolvedValue({ items: [pending], total: 1, page: 1, pageSize: 10 })
  api.facets.mockResolvedValue({ modules: ['host.settings.users'], actions: ['Update'], makers: ['Asha Rao'], checkers: ['Ben Ito'] })
  api.summary.mockResolvedValue({ pendingTotal: 1, approvedToday: 0, rejectedToday: 0, assignedToMePending: 1 })
  api.get.mockResolvedValue(detailOf(pending))
  api.exportCsv.mockResolvedValue({ filename: 'a.csv', rowCount: 1, matchCount: 1, truncated: false, rowLimit: 10000 })
  signInAs(CHECKER_ID)
})

describe('the queue is queried by the server', () => {
  it('asks for one page, never a 200-row sample', async () => {
    renderPage()

    await waitFor(() => expect(api.list).toHaveBeenCalled())

    expect(lastParams(api.list)).toMatchObject({ status: 'Pending', page: 1, pageSize: expect.any(Number) })
    expect(api.list.mock.calls.every((c) => (c[1] as { pageSize: number }).pageSize <= 100)).toBe(true)
  })

  it('fetches both decided states for Processed in one request, newest decision first', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('jane@example.com')
    api.list.mockClear()

    await user.click(screen.getByRole('tab', { name: /processed/i }))

    await waitFor(() => expect(api.list).toHaveBeenCalledTimes(1))
    expect(lastParams(api.list)).toMatchObject({ status: 'Approved,Rejected', sortBy: 'decided' })
  })

  it('sends "assigned to me" as a parameter rather than filtering the page it got back', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('jane@example.com')

    await user.click(screen.getAllByRole('checkbox', { name: /assigned to me/i })[0])

    await waitFor(() => expect(lastParams(api.list)).toMatchObject({ assignedToMe: true }))
  })

  /** A maker none of whose requests are on this page must still be pickable. */
  it('offers maker names from the facets endpoint, not from the rows on screen', async () => {
    api.facets.mockResolvedValue({ modules: [], actions: [], makers: ['Zoe Quinn'], checkers: [] })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('jane@example.com')
    await waitFor(() => expect(lastParams(api.facets)).toMatchObject({ status: 'Pending' }))

    await user.click(screen.getByRole('button', { name: /^maker/i }))

    expect(await screen.findByRole('button', { name: /zoe quinn/i })).toBeInTheDocument()
  })

  it('exports with exactly the filters the table is using', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('jane@example.com')
    await user.click(screen.getByRole('tab', { name: /processed/i }))
    await waitFor(() => expect(lastParams(api.list)).toMatchObject({ status: 'Approved,Rejected' }))

    await user.click(screen.getByRole('button', { name: /export csv/i }))
    await waitFor(() => expect(api.exportCsv).toHaveBeenCalled())

    const { page: _p, pageSize: _s, ...tableFilter } = lastParams(api.list)
    expect(lastParams(api.exportCsv)).toEqual(tableFilter)
  })
})

describe('deciding', () => {
  it('lets the assigned checker approve, and sends the request id', async () => {
    const user = userEvent.setup()
    api.approve.mockResolvedValue(detailOf(item(), { status: 'Approved', decidedAt: '2026-09-12T10:00:00Z' }))
    renderPage()

    await openRequest(user)
    await user.click(await screen.findByRole('button', { name: 'Approve' }))

    expect(api.approve).toHaveBeenCalledWith('token', 'req-1')
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument())
  })

  it('will not submit a rejection without a reason, and sends the reason it was given', async () => {
    const user = userEvent.setup()
    api.reject.mockResolvedValue(detailOf(item(), { status: 'Rejected', rejectionReason: 'Wrong email' }))
    renderPage()

    await openRequest(user)
    await user.click(await screen.findByRole('button', { name: 'Reject' }))
    const confirm = screen.getByRole('button', { name: 'Confirm Reject' })
    expect(confirm).toBeDisabled()

    await user.type(screen.getByPlaceholderText(/explain why/i), '  Wrong email  ')
    await user.click(confirm)

    expect(api.reject).toHaveBeenCalledWith('token', 'req-1', 'Wrong email')
  })

  it('shows no decision controls on a request assigned to someone else', async () => {
    const user = userEvent.setup()
    signInAs('someone-else')
    renderPage()

    await openRequest(user)
    await screen.findByText('Asha Rao', { selector: '*' })

    expect(screen.queryByRole('button', { name: 'Approve' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reject' })).not.toBeInTheDocument()
  })

  /** The server is the authority; the page must show its refusal rather than a generic failure. */
  it('shows the server’s reason when a decision is refused', async () => {
    const user = userEvent.setup()
    api.approve.mockRejectedValue(new ApiError(409, 'This request has already been approved.'))
    renderPage()

    await openRequest(user)
    await user.click(await screen.findByRole('button', { name: 'Approve' }))

    expect(await screen.findByText('This request has already been approved.')).toBeInTheDocument()
  })
})
