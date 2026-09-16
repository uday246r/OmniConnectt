import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { useLeadStore } from '../../store/useLeadStore'
import { LeadDetailsDrawer } from './LeadDetailsDrawer'

/**
 * The lead details drawer, as someone who works with customers reads it.
 *
 * It had two ways to close it (the header X and a "Close Details" button) and showed the lead's
 * database id twice — a "Lead ID" footer with a copy button and a "System Record Reference" field.
 * Neither id means anything to the person reading, nor can they act on it. These pin one close
 * control and no internal identifier, while the details that matter still show.
 */

const LEAD_ID = '6f1c2b0e-5d6a-4b7e-9c1d-2a3b4c5d6e7f'

beforeEach(() => {
  useLeadStore.setState({
    isDetailsDrawerOpen: true,
    fieldConfig: [],
    selectedLead: {
      id: LEAD_ID,
      name: 'Asha Rao',
      icNumber: '880512-14-5678',
      phone: '+60 12-345 6789',
      email: 'asha@example.com',
      product: 'Home Financing',
      state: 'Selangor',
      branch: 'Shah Alam',
      status: 'New',
      createdDate: '2026-09-01',
    },
  })
})

describe('LeadDetailsDrawer', () => {
  it('has one way to close it', () => {
    render(<LeadDetailsDrawer />)

    expect(screen.queryByRole('button', { name: /close details$/i })).not.toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /close/i })).toHaveLength(1)
  })

  it('shows no internal record id', () => {
    const { container } = render(<LeadDetailsDrawer />)

    expect(container.ownerDocument.body.textContent).not.toContain(LEAD_ID)
    expect(container.ownerDocument.body.textContent).not.toContain(LEAD_ID.slice(0, 16))
    expect(screen.queryByText(/lead id|system record reference/i)).not.toBeInTheDocument()
  })

  it('still shows the customer', () => {
    render(<LeadDetailsDrawer />)

    expect(screen.getAllByText('Asha Rao').length).toBeGreaterThan(0)
  })

  it('closes from the header control', async () => {
    render(<LeadDetailsDrawer />)

    await userEvent.click(screen.getByRole('button', { name: /close/i }))

    expect(useLeadStore.getState().isDetailsDrawerOpen).toBe(false)
  })
})
