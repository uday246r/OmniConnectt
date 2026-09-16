import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthStore } from '../../../auth/store/authStore'
import { ApiError } from '../../../../shared/api/httpClient'
import type { AuditLogDto } from '../../../system-audit-logs/api/auditLogsApi'

vi.mock('../../../system-audit-logs/api/auditLogsApi', () => ({
  auditLogsApi: {
    list: vi.fn(),
    facets: vi.fn(),
    exportCsv: vi.fn(),
  },
}))
import { auditLogsApi } from '../../../system-audit-logs/api/auditLogsApi'
import { UserActivityTab } from './UserActivityTab'

/**
 * A user's Audit Log tab.
 *
 * It used to read a fixed pool of the user's latest rows and page it in the browser, so older history
 * was unreachable, and it asked only for rows the user performed — never what was done to them. These
 * pin that the tab asks the server for the user's whole involvement one page at a time, that "by" and
 * "about" are real server filters the export honours too, that each row says who acted, and that a
 * missing audit permission reads as a permission message rather than "no activity".
 */

const list = vi.mocked(auditLogsApi.list)
const facets = vi.mocked(auditLogsApi.facets)
const exportCsv = vi.mocked(auditLogsApi.exportCsv)
const USER = '11111111-1111-1111-1111-111111111111'

function row(over: Partial<AuditLogDto>): AuditLogDto {
  return {
    id: crypto.randomUUID(), occurredAt: '2026-09-01T10:00:00Z', serviceName: 'AuthService', actorUserId: USER,
    actorName: 'Priya Nair', action: 'auth.login_succeeded', entityType: 'User', entityId: USER, entityLabel: 'Priya Nair',
    details: 'Signed in.', sourceIp: null, authMethod: null, result: 'Success', userAgent: null, failureReason: null,
    correlationId: 'c', sourceApplication: 'Host', module: null, page: null, actionCategory: null, ...over,
  }
}

function renderTab() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <UserActivityTab userId={USER} userName="Priya Nair" />
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  list.mockReset()
  facets.mockReset()
  exportCsv.mockReset()
  facets.mockResolvedValue({ services: ['Host'], actions: [], authMethods: [], modules: [], pages: [], actionCategories: [] })
  // Signing a user in triggers a real fine-capability fetch; failing, it would sign the test user out mid-test.
  useAuthStore.setState({ loadFineCapabilities: () => Promise.resolve() })
  useAuthStore.setState({
    accessToken: 'tok',
    user: { id: 'admin', name: 'Admin', email: 'a@example.com', isAdministrator: true, permissions: [] } as never,
  })
})

describe('UserActivityTab', () => {
  it('asks the server for everything involving the user, one page at a time', async () => {
    list.mockResolvedValue({ items: [row({})], total: 57, page: 1, pageSize: 10 })

    renderTab()

    await screen.findByText('Login Succeeded')
    expect(list).toHaveBeenCalledWith('tok', expect.objectContaining({ involvingUserId: USER, page: 1, pageSize: 10 }), expect.anything())
    expect(list.mock.calls[0][1]).not.toHaveProperty('actorUserId')
  })

  it('reaches older history through server paging', async () => {
    list.mockResolvedValue({ items: [row({})], total: 57, page: 1, pageSize: 10 })
    renderTab()
    await screen.findByText('Login Succeeded')

    fireEvent.click(screen.getByRole('button', { name: /go to next page/i }))

    await waitFor(() => expect(list).toHaveBeenLastCalledWith('tok', expect.objectContaining({ page: 2 }), expect.anything()))
  })

  it('says who acted — the user, or someone acting on them', async () => {
    list.mockResolvedValue({
      items: [row({ details: 'Signed in.' }), row({ actorUserId: 'admin', actorName: 'Ben Ito', action: 'user.updated', details: 'Changed role.' })],
      total: 2, page: 1, pageSize: 10,
    })

    renderTab()

    expect(await screen.findByText('Ben Ito')).toBeInTheDocument()
    expect(screen.getAllByText(/about this user/).length).toBeGreaterThan(0)
    expect(screen.getAllByText(/this user/).length).toBeGreaterThan(1)
  })

  it('exports exactly what the table is showing', async () => {
    list.mockResolvedValue({ items: [row({})], total: 1, page: 1, pageSize: 10 })
    exportCsv.mockResolvedValue({ rowCount: 1, matchCount: 1, rowLimit: 10000, truncated: false } as never)
    renderTab()
    await screen.findByText('Login Succeeded')

    const btn = screen.getByRole('button', { name: /export report/i })
    fireEvent.click(btn)

    expect(exportCsv).toHaveBeenCalledWith('tok', expect.objectContaining({ involvingUserId: USER }))
  })

  it('explains a missing audit permission instead of showing an empty history', async () => {
    useAuthStore.setState({
      user: { id: 'u', name: 'U', email: 'u@example.com', isAdministrator: false, permissions: [] } as never,
      hasCapability: () => false,
    } as never)

    renderTab()

    expect(screen.getByText("You can't see audit history")).toBeInTheDocument()
    expect(list).not.toHaveBeenCalled()
  })

  it('treats a 403 from the server the same way', async () => {
    list.mockRejectedValue(new ApiError(403, 'Forbidden'))

    renderTab()

    expect(await screen.findByText("You can't see audit history")).toBeInTheDocument()
  })
})
