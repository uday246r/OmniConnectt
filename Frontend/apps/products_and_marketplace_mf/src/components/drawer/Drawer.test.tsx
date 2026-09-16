import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { Drawer, DrawerSection } from './Drawer'

/**
 * Products drawers on the platform drawer.
 *
 * This app had its own drawer implementation, so its nineteen drawers looked and closed differently
 * from every other drawer on the platform. The adapter keeps the call sites' props but renders the
 * shared component: one close control, Escape to close, the badge still visible, sections with titles.
 */
describe('Products Drawer', () => {
  it('renders one close control, closes on it and on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(
      <Drawer isOpen onClose={onClose} title="Home Loan" subtitle="Loans">
        body
      </Drawer>,
    )

    expect(screen.getAllByRole('button', { name: /close/i })).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: /close/i }))
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('renders nothing when closed', () => {
    render(
      <Drawer isOpen={false} onClose={() => {}} title="Hidden">
        body
      </Drawer>,
    )

    expect(screen.queryByRole('dialog')).toBeNull()
  })

  it('keeps the badge the header used to carry, in the body', () => {
    render(
      <Drawer isOpen onClose={() => {}} title="APP-1001" badge={<span>Approved</span>}>
        body
      </Drawer>,
    )

    expect(screen.getByRole('dialog')).toHaveTextContent('Approved')
  })

  it('titles a section and shows its action', () => {
    render(
      <DrawerSection title="Benefits" icon="check" action={<button type="button">Add benefit</button>}>
        <p>Low fees</p>
      </DrawerSection>,
    )

    expect(screen.getByRole('heading', { name: 'Benefits' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add benefit' })).toBeInTheDocument()
    expect(screen.getByText('Low fees')).toBeInTheDocument()
  })
})
