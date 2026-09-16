import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ConfirmModal } from './ConfirmModal'

/**
 * Confirmations on the platform dialog.
 *
 * The old dialog had no Cancel button (only a corner ×), called every confirmation a "Deletion
 * Notice", and printed details even when they had no value. These tests pin the replacement's
 * behaviour for the eight screens that use it.
 */
function renderModal(overrides: Partial<Parameters<typeof ConfirmModal>[0]> = {}) {
  const props = {
    isOpen: true,
    title: 'Delete Category',
    message: 'This category will be removed.',
    entityName: 'Loans',
    details: [
      { label: 'Products', value: 4 },
      { label: 'Owner', value: null },
    ],
    onConfirm: vi.fn(),
    onCancel: vi.fn(),
    ...overrides,
  }
  render(<ConfirmModal {...props} />)
  return props
}

describe('ConfirmModal', () => {
  it('shows the message, the target and only the details that have a value', () => {
    renderModal()

    expect(screen.getByRole('dialog')).toHaveTextContent('This category will be removed.')
    expect(screen.getByText('Loans')).toBeInTheDocument()
    expect(screen.getByText('Products')).toBeInTheDocument()
    expect(screen.queryByText('Owner')).toBeNull()
  })

  it('confirms and cancels through explicit buttons', async () => {
    const user = userEvent.setup()
    const props = renderModal()

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Delete' }))

    expect(props.onCancel).toHaveBeenCalledTimes(1)
    expect(props.onConfirm).toHaveBeenCalledTimes(1)
  })

  it('shows a server refusal and blocks both buttons while working', () => {
    renderModal({ errorMessage: 'Category has active products.', isLoading: true })

    expect(screen.getByRole('alert')).toHaveTextContent('Category has active products.')
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Processing...' })).toBeDisabled()
  })

  it('does not describe a non-destructive action as permanent', () => {
    renderModal({ variant: 'primary', confirmText: 'Publish' })

    expect(screen.queryByText(/cannot be undone/i)).toBeNull()
    expect(screen.getByRole('button', { name: 'Publish' })).toBeInTheDocument()
  })

  it('renders nothing when closed', () => {
    renderModal({ isOpen: false })

    expect(screen.queryByRole('dialog')).toBeNull()
  })
})
