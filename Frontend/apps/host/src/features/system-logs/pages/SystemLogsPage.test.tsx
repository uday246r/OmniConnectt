import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { renderWithQuery } from '../../../test/renderWithQuery'
import { useAuthStore } from '../../auth/store/authStore'
import type { SystemLogDto } from '../api/systemLogsApi'

/**
 * The System Logs list: server-paged, cached, and readable.
 *
 * Three behaviours are pinned. The page asks the server for the page and filters on screen. Coming
 * back to the page is served from the cache, where it used to show a skeleton and refetch every time.
 * And the table names events in words, keeping the raw code as its tooltip, with identifiers only in
 * the drawer's collapsed technical section.
 */

const api = vi.hoisted(() => ({
  list: vi.fn(),
  summary: vi.fn(),
  exportCsv: vi.fn(),
}))

vi.mock('../api/systemLogsApi', () => ({ systemLogsApi: api }))

const { SystemLogsPage } = await import('./SystemLogsPage')

const CORRELATION_ID = '6f2c1a9e-8b1d-4f7e-9a44-2b3c4d5e6f70'

function log(over: Partial<SystemLogDto> = {}): SystemLogDto {
  return {
    id: crypto.randomUUID(),
    occurredAt: '2026-09-12T10:00:00Z',
    severity: 'Error',
    serviceName: 'AuthService',
    module: null,
    environment: 'Development',
    tenantId: null,
    userId: null,
    correlationId: CORRELATION_ID,
    requestId: null,
    statusCode: 500,
    eventCode: 'unhandled_exception',
    message: 'Database connection was reset.',
    stackTrace: null,
    metadata: null,
    ...over,
  }
}

function renderPage() {
  return renderWithQuery(<SystemLogsPage />, { route: '/system/system-logs' })
}

function lastParams() {
  return api.list.mock.calls.at(-1)?.[1] as Record<string, unknown>
}

beforeEach(() => {
  vi.clearAllMocks()
  localStorage.clear()
  api.list.mockResolvedValue({ items: [log()], total: 4321, page: 1, pageSize: 10 })
  api.summary.mockResolvedValue({ errorCount: 12, warningCount: 3, infoCount: 40, criticalCount: 1, totalEvents: 56, servicesReporting: 4 })
  useAuthStore.setState({
    status: 'authenticated',
    accessToken: 'token',
    user: { id: 'me', name: 'Admin', email: 'admin@example.com', isAdministrator: true, permissions: [] } as never,
  })
})

describe('System Logs list', () => {
  it('asks the server for one page, newest first', async () => {
    renderPage()

    expect(await screen.findByText('Database connection was reset.')).toBeInTheDocument()
    expect(lastParams()).toMatchObject({ page: 1, pageSize: 10, sortDir: 'desc' })
  })

  it('names the event in words and keeps the raw code as the tooltip', async () => {
    renderPage()

    const event = await screen.findByText('Unhandled exception')
    expect(event).toHaveAttribute('title', 'unhandled_exception')
    expect(screen.queryByText(CORRELATION_ID)).toBeNull()
  })

  it('sends the Errors tab as a severity filter from page one', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Database connection was reset.')

    await user.click(screen.getByRole('button', { name: /^errors/i }))

    await waitFor(() => expect(lastParams()).toMatchObject({ severity: 'Error', page: 1 }))
  })

  it('opens the drawer with identifiers hidden until Technical details is expanded', async () => {
    const user = userEvent.setup()
    renderPage()
    await screen.findByText('Database connection was reset.')

    await user.click(screen.getByRole('button', { name: 'View' }))

    const hiddenId = screen.getByText(CORRELATION_ID)
    expect(hiddenId).not.toBeVisible()
    await user.click(screen.getByText('Technical details'))
    expect(hiddenId).toBeVisible()
  })
})

describe('coming back to the page', () => {
  it('shows the rows it already had without asking the server again', async () => {
    const first = renderPage()
    expect(await screen.findByText('Database connection was reset.')).toBeInTheDocument()
    await waitFor(() => expect(api.summary).toHaveBeenCalled())
    const calls = { list: api.list.mock.calls.length, summary: api.summary.mock.calls.length }
    first.unmount()

    renderWithQuery(<SystemLogsPage />, { client: first.client, route: '/system/system-logs' })

    expect(screen.getByText('Database connection was reset.')).toBeInTheDocument()
    expect(api.list.mock.calls.length).toBe(calls.list)
    expect(api.summary.mock.calls.length).toBe(calls.summary)
  })

  it('refetches when a new system log is published', async () => {
    const { invalidate, TOPICS } = await import('../../../shared/stores/invalidationStore')
    const { installInvalidationBridge } = await import('../../../shared/query/invalidationBridge')
    const { client } = renderPage()
    const uninstall = installInvalidationBridge(client)
    expect(await screen.findByText('Database connection was reset.')).toBeInTheDocument()
    const before = api.list.mock.calls.length

    invalidate(TOPICS.systemLogs)

    await waitFor(() => expect(api.list.mock.calls.length).toBeGreaterThan(before))
    uninstall()
  })
})
