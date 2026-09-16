import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '../../../test/renderWithQuery'
import { useAuthStore } from '../../auth/store/authStore'
import type { UserListItemDto } from '../api/usersApi'

/**
 * The Users directory is a view over server-side paging.
 *
 * The page used to fetch one page of users — asking for 200, which the server clamps to 100 — and
 * filter, count and page that sample in the browser. Past 100 accounts the rest of the directory could
 * not be found by any filter and the cards counted the sample. These tests pin what replaced it: the
 * table asks the server for exactly the page and filters on screen, the cards show the server's counts
 * for the whole directory, and revisiting the page is served from the cache.
 */

const api = vi.hoisted(() => ({
  list: vi.fn(),
  summary: vi.fn(),
  facets: vi.fn(),
}))

vi.mock('../api/usersApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/usersApi')>()),
  usersApi: api,
}))

const { UsersPage } = await import('./UsersPage')

function user(over: Partial<UserListItemDto> = {}): UserListItemDto {
  return {
    id: crypto.randomUUID(),
    salutation: null,
    name: 'Asha Rao',
    email: 'asha@example.com',
    phoneNumber: '+60 12-345 6789',
    roleId: 'r-1',
    roleName: 'Auditor',
    isAdministrator: false,
    isActive: true,
    lastLoginAt: null,
    authProvider: 'Local',
    ...over,
  }
}

function renderPage() {
  return renderWithQuery(<UsersPage />, { route: '/settings/users' })
}

/** The params object the most recent list call was given (ignoring type-ahead calls). */
function lastListParams() {
  const pageCalls = api.list.mock.calls.filter((c) => (c[1] as { pageSize: number }).pageSize === 10)
  return pageCalls.at(-1)?.[1] as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  api.list.mockResolvedValue({ items: [user(), user({ name: 'Ben Ito', email: 'ben@example.com', roleName: null, roleId: null })], total: 1250, page: 1, pageSize: 10 })
  api.summary.mockResolvedValue({ total: 1250, active: 1200, inactive: 50, administrators: 3 })
  api.facets.mockResolvedValue({ roles: ['Auditor', 'No Role'] })
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'token',
    user: { id: 'me', name: 'Admin', email: 'admin@example.com', isAdministrator: true, permissions: [] } as never,
  })
})

describe('Users directory', () => {
  it('asks the server for one page and shows the whole directory counts it returns', async () => {
    renderPage()

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument()
    expect(lastListParams()).toMatchObject({ page: 1, pageSize: 10 })
    expect(await screen.findByText('1,250')).toBeInTheDocument()
    expect(screen.getByText('1,200')).toBeInTheDocument()
    expect(screen.getByText('No Role')).toBeInTheDocument()
  })

  it('reaches pages beyond the first hundred users', async () => {
    const u = userEvent.setup()
    renderPage()
    await screen.findByText('Asha Rao')

    await u.click(screen.getByRole('button', { name: 'Go to next page' }))

    await waitFor(() => expect(lastListParams()).toMatchObject({ page: 2, pageSize: 10 }))
  })

  it('sends the quick search to the server and starts again from the first page', async () => {
    const u = userEvent.setup()
    renderPage()
    await screen.findByText('Asha Rao')
    await u.click(screen.getByRole('button', { name: 'Go to next page' }))
    await waitFor(() => expect(lastListParams()).toMatchObject({ page: 2 }))

    await u.type(screen.getByPlaceholderText(/search by name, email, mobile, or role/i), 'asha')

    await waitFor(() => expect(lastListParams()).toMatchObject({ search: 'asha', page: 1 }))
    // Type-ahead suggestions come from the server too, not from the rows on screen.
    await waitFor(() => expect(api.list.mock.calls.some((c) => c[1].search === 'asha' && c[1].pageSize === 8)).toBe(true))
  })

  it('shows the server message when the list cannot be loaded', async () => {
    const { ApiError } = await import('../../../shared/api/httpClient')
    api.list.mockRejectedValue(new ApiError(403, 'You do not have permission to view users.'))

    renderPage()

    expect(await screen.findByRole('alert')).toHaveTextContent('You do not have permission to view users.')
  })
})

describe('coming back to the page', () => {
  it('shows the rows it already had without asking the server again', async () => {
    const first = renderPage()
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument()
    await screen.findByText('1,250')
    const calls = { list: api.list.mock.calls.length, summary: api.summary.mock.calls.length, facets: api.facets.mock.calls.length }
    first.unmount()

    renderWithQuery(<UsersPage />, { client: first.client, route: '/settings/users' })

    expect(screen.getByText('Asha Rao')).toBeInTheDocument()
    expect(api.list.mock.calls.length).toBe(calls.list)
    expect(api.summary.mock.calls.length).toBe(calls.summary)
    expect(api.facets.mock.calls.length).toBe(calls.facets)
  })

  it('refetches when a user changes anywhere', async () => {
    const { invalidate, TOPICS } = await import('../../../shared/stores/invalidationStore')
    const { installInvalidationBridge } = await import('../../../shared/query/invalidationBridge')
    const { client } = renderPage()
    const uninstall = installInvalidationBridge(client)
    expect(await screen.findByText('Asha Rao')).toBeInTheDocument()
    const before = { list: api.list.mock.calls.length, summary: api.summary.mock.calls.length }

    invalidate(TOPICS.users)

    await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(before.list))
    await waitFor(() => expect(api.summary.mock.calls.length).toBeGreaterThan(before.summary))
    uninstall()
  })
})
