import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'
import { ApiError } from '../../../shared/api/httpClient'
import { asPendingApprovalConflict, type PendingApprovalConflict } from '../pendingConflict'
import { PendingApprovalDialog } from './PendingApprovalDialog'

/**
 * The "one open request per record" refusal, as the maker meets it.
 *
 * A second change to a record that already has a request awaiting approval is refused with a 409
 * carrying the blocking request. That is not the maker's mistake, so it must become an explanation —
 * who raised it, who it is waiting on, where to go — and never be confused with a 409 that IS a
 * mistake (a duplicate email, a role still in use), which keeps its ordinary error handling.
 */

const conflict: PendingApprovalConflict = {
  approvalRequestId: 'req-1',
  module: 'host.settings.users',
  action: 'Update',
  entityLabel: 'jane@example.com',
  makerName: 'Asha Rao',
  checkerName: 'Ben Ito',
  requestedAt: '2026-09-12T09:00:00Z',
  isOwnRequest: false,
}

describe('recognising the refusal', () => {
  it('reads the blocking request out of a 409', () => {
    const err = new ApiError(409, 'Already pending', null, { pendingRequest: conflict })

    expect(asPendingApprovalConflict(err)).toEqual(conflict)
  })

  it('leaves an ordinary 409 to the normal error path', () => {
    expect(asPendingApprovalConflict(new ApiError(409, 'That email is already in use.'))).toBeNull()
  })

  it('ignores the same shape on any other status', () => {
    expect(asPendingApprovalConflict(new ApiError(400, 'Bad', null, { pendingRequest: conflict }))).toBeNull()
    expect(asPendingApprovalConflict(new Error('boom'))).toBeNull()
  })
})

describe('explaining it', () => {
  function renderDialog(value: PendingApprovalConflict, onClose = vi.fn()) {
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <Routes>
          <Route path="/settings" element={<PendingApprovalDialog conflict={value} onClose={onClose} />} />
          <Route path="/system/approvals" element={<p>approval center</p>} />
          <Route path="/my-requests" element={<p>my requests</p>} />
        </Routes>
      </MemoryRouter>,
    )
    return onClose
  }

  it('names who raised it, what it changes and who it is waiting on', () => {
    renderDialog(conflict)

    expect(screen.getByText(/Asha Rao has already requested a/)).toBeInTheDocument()
    expect(screen.getByText('update')).toBeInTheDocument()
    expect(screen.getByText(/jane@example\.com/)).toBeInTheDocument()
    expect(screen.getByText('Ben Ito')).toBeInTheDocument()
  })

  it('sends someone else’s blocked maker to the Approval Center', async () => {
    const user = userEvent.setup()
    const onClose = renderDialog(conflict)

    await user.click(screen.getByRole('button', { name: 'Open Approval Center' }))

    expect(onClose).toHaveBeenCalled()
    expect(screen.getByText('approval center')).toBeInTheDocument()
  })

  it('speaks to the maker directly when the open request is their own, and sends them to My Requests', async () => {
    const user = userEvent.setup()
    renderDialog({ ...conflict, isOwnRequest: true })

    expect(screen.getByText(/You have already requested a/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'View my requests' }))

    expect(screen.getByText('my requests')).toBeInTheDocument()
  })
})
