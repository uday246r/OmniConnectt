import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../../auth/store/authStore'
import type { AuditLogDto } from '../api/auditLogsApi'

/**
 * The host Audit Logs screen is a thin view over one server-side filter.
 *
 * Two things went wrong here before, and neither was visible on screen. The page fetched the newest
 * 200 rows and filtered and paged them in the browser, so anything older was unreachable and the
 * pager described a sample rather than the trail. And the export built its own subset of the
 * filters, so a CSV taken from a filtered view silently answered a broader question.
 *
 * These tests pin the contract that replaced both: the server pages, and the table, the facets, the
 * summary and the export all receive the same bounds.
 */

const api = vi.hoisted(() => ({
  list: vi.fn(),
  summary: vi.fn(),
  facets: vi.fn(),
  exportCsv: vi.fn(),
}))

vi.mock('../api/auditLogsApi', () => ({ auditLogsApi: api }))

const { AuditLogsPage } = await import('./AuditLogsPage')

function row(over: Partial<AuditLogDto> = {}): AuditLogDto {
  return {
    id: crypto.randomUUID(),
    occurredAt: '2026-09-12T10:00:00Z',
    serviceName: 'AuthService',
    actorUserId: 'u-1',
    actorName: 'Asha Rao',
    action: 'user.created',
    entityType: 'User',
    entityId: 'e-1',
    entityLabel: 'new.hire@example.com',
    details: null,
    sourceIp: '10.0.0.1',
    authMethod: null,
    result: 'Success',
    userAgent: null,
    failureReason: null,
    correlationId: null,
    sourceApplication: 'Host',
    module: 'Users',
    page: null,
    actionCategory: 'CRUD',
    hostOrRemote: 'Host',
    remoteName: null,
    ...over,
  } as AuditLogDto
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/system/audit-logs']}>
      <AuditLogsPage />
    </MemoryRouter>,
  )
}

/** The params object the most recent call to `fn` was given. */
function lastParams(fn: ReturnType<typeof vi.fn>) {
  return fn.mock.calls.at(-1)?.[1] as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  api.list.mockResolvedValue({ items: [row(), row({ actorName: 'Ben Ito', action: 'role.updated' })], total: 57, page: 1, pageSize: 10 })
  api.summary.mockResolvedValue({ loginSuccesses: 1, loginErrors: 0, totalAuditEvents: 57, activeUsers: 2 })
  api.facets.mockResolvedValue({ services: ['AuthService'], actions: [{ action: 'user.created', count: 1 }], authMethods: [] })
  api.exportCsv.mockResolvedValue({ filename: 'audit.csv', rowCount: 57, matchCount: 57, truncated: false, rowLimit: 10000 })
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'token',
    user: { id: 'admin', name: 'Admin', email: 'admin@example.com', isAdministrator: true, permissions: [] } as never,
  })
})

describe('paging is the server’s', () => {
  it('asks for one page at a time instead of pre-fetching a sample', async () => {
    renderPage()

    await waitFor(() => expect(api.list).toHaveBeenCalled())

    expect(lastParams(api.list)).toMatchObject({ page: 1, pageSize: 10 })
    expect(api.list.mock.calls.every((c) => (c[1] as { pageSize: number }).pageSize !== 200)).toBe(true)
  })

  it('describes the whole matching trail, not the rows it happens to hold', async () => {
    renderPage()

    expect(await screen.findByText('Asha Rao')).toBeInTheDocument()
    // The pager splits its numbers into <strong>s, so match on the assembled sentence.
    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && /Showing 1 to 10 of 57 events?/.test(el.textContent ?? ''))).toBeInTheDocument()
  })
})

describe('one set of bounds everywhere', () => {
  it('sends the chosen date range to the table, the facets, the summary and the export alike', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Asha Rao')

    await user.click(screen.getByRole('button', { name: 'Date Range' }))
    await user.click(screen.getByRole('button', { name: 'Last 7 Days' }))
    await user.click(screen.getByRole('button', { name: 'Apply' }))
    await waitFor(() => expect(lastParams(api.list).from).toBeDefined())

    await user.click(screen.getByRole('button', { name: /export csv/i }))
    await waitFor(() => expect(api.exportCsv).toHaveBeenCalled())

    const { from, to } = lastParams(api.list)
    expect(typeof from).toBe('string')
    expect(typeof to).toBe('string')
    for (const fn of [api.facets, api.summary, api.exportCsv]) {
      expect(lastParams(fn)).toMatchObject({ from, to })
    }
  })

  it('exports with every filter the table is showing, not a subset of them', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Asha Rao')

    await user.click(screen.getByRole('tab', { name: 'Failed Sign-ins' }))
    await waitFor(() => expect(lastParams(api.list)).toMatchObject({ action: 'auth.login_failed', result: 'Failure' }))

    await user.click(screen.getByRole('button', { name: /export csv/i }))
    await waitFor(() => expect(api.exportCsv).toHaveBeenCalled())

    const { page: _page, pageSize: _pageSize, ...tableFilter } = lastParams(api.list)
    expect(lastParams(api.exportCsv)).toEqual(tableFilter)
  })

  it('re-reads the dropdown options under the filters already applied', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Asha Rao')

    await user.click(screen.getByRole('tab', { name: 'Sign-ins' }))

    await waitFor(() => expect(lastParams(api.facets)).toMatchObject({ action: 'auth.login_succeeded' }))
  })
})

describe('export outcomes', () => {
  it('says so when the server capped the file, instead of reporting a quiet success', async () => {
    api.exportCsv.mockResolvedValue({ filename: 'audit.csv', rowCount: 10000, matchCount: 12500, truncated: true, rowLimit: 10000 })
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Asha Rao')

    await user.click(screen.getByRole('button', { name: /export csv/i }))

    expect(await screen.findByText(/newest 10,000 of 12,500 matching rows/)).toBeInTheDocument()
  })

  it('offers no export to someone without the Export capability', async () => {
    useAuthStore.setState({
      user: { id: 'viewer', name: 'Viewer', email: 'v@example.com', isAdministrator: false, permissions: ['host.system.audit-logs:View'] } as never,
    })
    renderPage()
    await screen.findByText('Asha Rao')

    expect(screen.queryByRole('button', { name: /export csv/i })).not.toBeInTheDocument()
  })
})

describe('reading is not writing', () => {
  /** Opening a row used to POST an "audit_log.details_viewed" row from the browser. */
  it('opens a row’s details without sending any request', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    const user = userEvent.setup()
    renderPage()
    const actor = await screen.findByText('Asha Rao')
    const callsBefore = api.list.mock.calls.length

    const rowEl = (actor.closest('tr') ?? actor.closest('[role="row"]')) as HTMLElement
    await user.click(within(rowEl).getAllByRole('button').at(-1)!)

    expect(fetchSpy).not.toHaveBeenCalled()
    expect(api.list.mock.calls.length).toBe(callsBefore)
    fetchSpy.mockRestore()
  })

  it('has no way to write an audit row from the browser at all', async () => {
    const actual = await vi.importActual<typeof import('../api/auditLogsApi')>('../api/auditLogsApi')

    expect(Object.keys(actual.auditLogsApi).sort()).toEqual(['exportCsv', 'facets', 'list', 'summary'])
  })
})
