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
  resendInvite: vi.fn(),
}))

vi.mock('../api/usersApi', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../api/usersApi')>()),
  usersApi: api,
}))

const { UsersPage } = await import('./UsersPage')
const { ToastContainer } = await import('../../../shared/components/Toast/ToastContainer')
const { useToastStore } = await import('../../../shared/stores/toastStore')

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
    awaitingPasswordSetup: false,
    ...over,
  }
}

function renderPage() {
  return renderWithQuery(<UsersPage />, { route: '/settings/users' })
}

/** Toasts render through a container the app mounts once at the root, so a test asserting on one needs it too. */
function renderPageWithToasts() {
  return renderWithQuery(
    <>
      <UsersPage />
      <ToastContainer />
    </>,
    { route: '/settings/users' },
  )
}

/** The params object the most recent list call was given (ignoring type-ahead calls). */
function lastListParams() {
  const pageCalls = api.list.mock.calls.filter((c) => (c[1] as { pageSize: number }).pageSize === 10)
  return pageCalls.at(-1)?.[1] as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  // The toast store is module-level, so a toast raised in one test is still on screen in the next.
  useToastStore.getState().clear()
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
    expect(screen.getByText('50')).toBeInTheDocument()
    expect(screen.getByText('Inactive')).toBeInTheDocument()
    expect(screen.getByText('No Role')).toBeInTheDocument()
    expect(screen.getByRole('columnheader', { name: 'Actions' })).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: 'View' })).toHaveLength(2)
    expect(screen.getAllByRole('button', { name: 'Edit user' })).toHaveLength(2)
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

/**
 * An account whose invite never landed cannot be signed into at all, and nothing on the server can
 * recover it — there is no stored credential any more, only a link that can be reissued. So the row
 * has to offer that reissue exactly when it applies, and must not claim success when the mail fails.
 */
describe('resending a set-password invite', () => {
  const pending = () => user({ name: 'New Hire', email: 'new.hire@example.com', awaitingPasswordSetup: true })

  it('offers it only on accounts still waiting to set a password', async () => {
    api.list.mockResolvedValue({ items: [pending(), user()], total: 2, page: 1, pageSize: 10 })
    renderPageWithToasts()
    await screen.findByText('New Hire')

    expect(screen.getAllByRole('button', { name: 'Resend invite email' })).toHaveLength(1)
  })

  it('confirms delivery with the address it reached', async () => {
    api.list.mockResolvedValue({ items: [pending()], total: 1, page: 1, pageSize: 10 })
    api.resendInvite.mockResolvedValue({ emailed: true })
    const u = userEvent.setup()
    renderPageWithToasts()
    await screen.findByText('New Hire')

    await u.click(screen.getByRole('button', { name: 'Resend invite email' }))

    expect(api.resendInvite).toHaveBeenCalledWith('token', expect.any(String))
    expect(await screen.findByText(/on its way to new\.hire@example\.com/i)).toBeInTheDocument()
  })

  it('warns rather than confirms when the server could not deliver it', async () => {
    api.list.mockResolvedValue({ items: [pending()], total: 1, page: 1, pageSize: 10 })
    api.resendInvite.mockResolvedValue({ emailed: false })
    const u = userEvent.setup()
    renderPageWithToasts()
    await screen.findByText('New Hire')

    await u.click(screen.getByRole('button', { name: 'Resend invite email' }))

    expect(await screen.findByText(/could not be delivered/i)).toBeInTheDocument()
    expect(screen.queryByText(/on its way/i)).not.toBeInTheDocument()
  })

  it('surfaces the server’s reason for refusing', async () => {
    const { ApiError } = await import('../../../shared/api/httpClient')
    api.list.mockResolvedValue({ items: [pending()], total: 1, page: 1, pageSize: 10 })
    api.resendInvite.mockRejectedValue(new ApiError(409, 'This user has already set their password.'))
    const u = userEvent.setup()
    renderPageWithToasts()
    await screen.findByText('New Hire')

    await u.click(screen.getByRole('button', { name: 'Resend invite email' }))

    expect(await screen.findByText('This user has already set their password.')).toBeInTheDocument()
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
