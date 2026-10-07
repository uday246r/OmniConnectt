import { describe, expect, it, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { RequireCapability } from './RequireCapability'
import { useAuthStore } from '../store/authStore'

/**
 * What a user sees when they open a URL for a section their account does not have.
 *
 * This used to render the 404 page, chosen so a denial could not confirm that a page existed. In
 * practice the people hitting it were not probing for hidden pages — they were following a bookmark
 * or a colleague's link, and a 404 told them the platform was broken rather than that this account
 * does not have that section. They now land on the dashboard, which is somewhere they can act.
 *
 * The hydrating case is the one that must not regress: redirecting before the session has been
 * restored would bounce a perfectly entitled user off the page they asked for, on every refresh.
 */

function renderAt(path: string, children = <p>secret</p>) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/" element={<p>dashboard</p>} />
        <Route
          path="/settings/users"
          element={<RequireCapability featureKey="host.settings.users">{children}</RequireCapability>}
        />
      </Routes>
    </MemoryRouter>,
  )
}

const user = {
  id: 'u1', name: 'T', email: 't@example.com', isAdministrator: false,
} as never

beforeEach(() => {
  useAuthStore.setState({ status: 'authenticated', user })
})

describe('RequireCapability', () => {
  it('renders the page for a user who holds the capability', () => {
    useAuthStore.setState({ hasCapability: () => true })

    renderAt('/settings/users')

    expect(screen.getByText('secret')).toBeInTheDocument()
  })

  it('sends a user without the capability to the dashboard, not to an error page', () => {
    useAuthStore.setState({ hasCapability: () => false })

    renderAt('/settings/users')

    expect(screen.getByText('dashboard')).toBeInTheDocument()
    expect(screen.queryByText('secret')).not.toBeInTheDocument()
  })

  it('lets an administrator through without a matching capability', () => {
    useAuthStore.setState({
      hasCapability: () => false,
      user: { ...user, isAdministrator: true } as never,
    })

    renderAt('/settings/users')

    expect(screen.getByText('secret')).toBeInTheDocument()
  })

  it('waits while the session is being restored instead of redirecting', () => {
    // Redirecting here would throw an entitled user off the page they asked for on every refresh,
    // because permissions are not known until hydrate() returns.
    useAuthStore.setState({ status: 'hydrating', hasCapability: () => false })

    renderAt('/settings/users')

    expect(screen.queryByText('dashboard')).not.toBeInTheDocument()
    expect(screen.queryByText('secret')).not.toBeInTheDocument()
  })
})
