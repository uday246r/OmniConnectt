import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it } from 'vitest'
import { PasswordExpiryBanner } from './PasswordExpiryBanner'
import { useAuthStore } from '../../features/auth/store/authStore'
import type { PasswordExpiryDto } from '../../shared/api/authServiceClient'

/**
 * The banner holds no policy of its own — it obeys the server's `showReminder`. What is worth pinning is
 * therefore the behaviour around that one boolean: it must not show for an expired account (the gate has
 * taken over) or with no date, and dismissing it must last the session but not silence tomorrow's warning.
 */

function signInWith(expiry: Partial<PasswordExpiryDto> | null) {
  useAuthStore.setState({
    user: {
      id: 'u1', name: 'Jane', email: 'jane@x.com', roleName: 'Analyst', isAdministrator: false,
      mustChangePassword: false, permissions: [], authProvider: 'Local', isActive: true,
      passwordExpiry: expiry === null ? null : { expiresAt: null, daysRemaining: 5, isExpired: false, showReminder: true, ...expiry },
    } as never,
  })
}

const renderBanner = () => render(<MemoryRouter><PasswordExpiryBanner /></MemoryRouter>)

beforeEach(() => {
  sessionStorage.clear()
})

describe('visibility', () => {
  it('tells the user how many days are left and links to where the password is changed', () => {
    signInWith({ daysRemaining: 5 })

    renderBanner()

    expect(screen.getByRole('status')).toHaveTextContent('Your password expires in 5 days')
    expect(screen.getByRole('link', { name: /change password/i })).toHaveAttribute('href', '/profile')
  })

  it('says "tomorrow" on the last day rather than "in 1 days"', () => {
    signInWith({ daysRemaining: 1 })

    renderBanner()

    expect(screen.getByRole('status')).toHaveTextContent('expires tomorrow')
  })

  it.each<[string, Partial<PasswordExpiryDto> | null]>([
    ['the server says not to (outside the window, or the in-app channel is off)', { showReminder: false }],
    ['the password has already expired — the blocking screen has taken over', { isExpired: true }],
    ['there is no day count', { daysRemaining: null }],
    ['the user has no expiry data at all', null],
  ])('renders nothing when %s', (_label, expiry) => {
    signInWith(expiry)

    const { container } = renderBanner()

    expect(container).toBeEmptyDOMElement()
  })
})

describe('dismissing', () => {
  it('hides the banner and keeps it hidden for the rest of the session at the same day count', async () => {
    signInWith({ daysRemaining: 5 })
    const first = renderBanner()

    await userEvent.click(screen.getByRole('button', { name: /dismiss password expiry reminder/i }))
    expect(first.container).toBeEmptyDOMElement()

    first.unmount()
    const remounted = renderBanner()
    expect(remounted.container).toBeEmptyDOMElement()
  })

  it('comes back the next day with the smaller count, because a warning that can be silenced for good stops being one', async () => {
    signInWith({ daysRemaining: 5 })
    const first = renderBanner()
    await userEvent.click(screen.getByRole('button', { name: /dismiss password expiry reminder/i }))
    first.unmount()

    signInWith({ daysRemaining: 4 })
    renderBanner()

    expect(screen.getByRole('status')).toHaveTextContent('expires in 4 days')
  })

  it('still hides it for this page load when session storage is blocked', async () => {
    signInWith({ daysRemaining: 5 })
    const original = Storage.prototype.setItem
    Storage.prototype.setItem = () => { throw new Error('blocked') }
    try {
      const view = renderBanner()

      await userEvent.click(screen.getByRole('button', { name: /dismiss password expiry reminder/i }))

      expect(view.container).toBeEmptyDOMElement()
    } finally {
      Storage.prototype.setItem = original
    }
  })
})
