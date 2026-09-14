import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Lead Management's audit screen: every filter is the server's, and the export matches the table.
 *
 * Performed By and Outcome used to narrow the ten rows already fetched while paging stayed on the
 * server. The two could not both be right — the pager was switched off whenever either filter was
 * on, matches on other pages were unreachable, and the CSV ignored both. They are query parameters
 * now; these tests pin that the list and the export receive the same ones, including the shared
 * date range.
 */

const getAuditLogs = vi.hoisted(() => vi.fn())
const remoteDownloadCsv = vi.hoisted(() => vi.fn())

vi.mock('../api/apiClient', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/apiClient')>()
  return { ...actual, apiClient: { ...actual.apiClient, getAuditLogs } }
})
vi.mock('../api/exportCsv', () => ({ remoteDownloadCsv }))
vi.mock('../api/hostBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/hostBridge')>()
  return { ...actual, canExportAuditLogs: () => true }
})

const { AuditLogsPage } = await import('./AuditLogsPage')
const { useLeadStore } = await import('../store/useLeadStore')
const { EMPTY_DATE_RANGE } = await import('@omniremit/ui')

const row = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  timestamp: '2026-09-12 09:00:00',
  userId: 'u1',
  userName: 'Aiman Hakim',
  userRole: 'Branch Officer',
  actionType: 'CREATE',
  entityType: 'Lead',
  entityId: 'L-1',
  description: 'Created lead for Tan Wei Ling',
  status: 'Success',
  ipAddress: '10.0.0.8',
  ...over,
})

/** The params object from the most recent list request. */
const lastListParams = () => getAuditLogs.mock.calls.at(-1)?.[0] as Record<string, unknown>

/** The query string of the most recent export request, as a plain object. */
const lastExportQuery = () => {
  const url = new URL(remoteDownloadCsv.mock.calls.at(-1)?.[0] as string)
  return Object.fromEntries(url.searchParams.entries())
}

beforeEach(() => {
  vi.clearAllMocks()
  getAuditLogs.mockResolvedValue({ items: [row(), row({ userName: 'Priya Raman', status: 'FAILED' })], totalRecords: 42, page: 1, pageSize: 10, totalPages: 5 })
  remoteDownloadCsv.mockResolvedValue({ filename: 'x.csv', rowCount: 1, matchCount: 1, truncated: false, rowLimit: 10000 })
  useLeadStore.setState({
    auditLogs: [], totalAuditRecords: 0, auditPage: 1, auditPageSize: 10, auditSearchQuery: '',
    auditActionFilter: '', auditActorFilter: '', auditStatusFilter: '', auditDateRange: EMPTY_DATE_RANGE,
  })
})

describe('filters are applied by the server', () => {
  it('pages through the whole trail rather than the rows it holds', async () => {
    render(<AuditLogsPage />)

    expect(await screen.findByText('Priya Raman')).toBeInTheDocument()
    expect(lastListParams()).toMatchObject({ page: 1, pageSize: 10 })
    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && /of 42 events?/.test(el.textContent ?? ''))).toBeInTheDocument()
  })

  it('sends the outcome filter to the server instead of hiding rows it already fetched', async () => {
    const user = userEvent.setup()
    render(<AuditLogsPage />)
    await screen.findByText('Priya Raman')

    await user.click(screen.getByRole('button', { name: /outcome & ip address/i }))
    await user.click(await screen.findByRole('button', { name: 'Failed' }))

    await waitFor(() => expect(lastListParams()).toMatchObject({ status: 'FAILED', page: 1 }))
    // Both rows the server returned stay on screen: the page no longer second-guesses it.
    expect(await screen.findByText('Aiman Hakim')).toBeInTheDocument()
  })

  it('sends the performed-by filter to the server', async () => {
    const user = userEvent.setup()
    render(<AuditLogsPage />)
    await screen.findByText('Priya Raman')

    await user.click(screen.getByRole('button', { name: /^performed by/i }))
    await user.click(await screen.findByRole('button', { name: 'Aiman Hakim' }))

    await waitFor(() => expect(lastListParams()).toMatchObject({ actor: 'Aiman Hakim' }))
  })
})

describe('the export', () => {
  it('carries exactly the filters the table was fetched with', async () => {
    useLeadStore.setState({ auditActionFilter: 'DELETE', auditActorFilter: 'Aiman', auditStatusFilter: 'FAILED', auditDateRange: { preset: 'week' } })
    const user = userEvent.setup()
    render(<AuditLogsPage />)
    await screen.findByText('Priya Raman')

    await user.click(screen.getByRole('button', { name: /export csv/i }))
    await waitFor(() => expect(remoteDownloadCsv).toHaveBeenCalled())

    const list = lastListParams()
    expect(lastExportQuery()).toEqual({
      actionType: list.actionType,
      actor: list.actor,
      status: list.status,
      from: list.from,
      to: list.to,
    })
    expect(typeof list.from).toBe('string')
  })

  it('says so when the server capped the file', async () => {
    remoteDownloadCsv.mockResolvedValue({ filename: 'x.csv', rowCount: 10000, matchCount: 15000, truncated: true, rowLimit: 10000 })
    const user = userEvent.setup()
    render(<AuditLogsPage />)
    await screen.findByText('Priya Raman')

    await user.click(screen.getByRole('button', { name: /export csv/i }))

    expect(await screen.findByText(/newest 10,000 of 15,000 matching rows/)).toBeInTheDocument()
  })
})
