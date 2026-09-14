import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * Customer 360's audit screen: every filter is the server's, and the export matches the table.
 *
 * Outcome, Performed By, Customer and Description used to narrow the page already fetched, because
 * the endpoint took only `search` and `action`. Matches on other pages were unreachable, the pager
 * had to be switched off while any of them was on, and the export ignored all four. They are query
 * parameters now; these tests pin that the table and the CSV are fetched with the same ones.
 */

const getAuditLogs = vi.hoisted(() => vi.fn())
const remoteDownloadCsv = vi.hoisted(() => vi.fn())

vi.mock('../services/api', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/api')>()
  return { ...actual, api: { ...actual.api, getAuditLogs } }
})
vi.mock('../services/exportCsv', () => ({ remoteDownloadCsv }))
vi.mock('../api/hostBridge', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../api/hostBridge')>()
  return { ...actual, canExportAuditLogs: () => true }
})

const { default: AuditLogs } = await import('./AuditLogs')

const LEGACY_ID = '60892301-eded-47ce-be0b-09a5823bc2bc'

const row = (over: Record<string, unknown> = {}) => ({
  id: crypto.randomUUID(),
  timestamp: '2026-09-12T09:00:00Z',
  user: 'Aiman Hakim',
  action: 'VIEW_PROFILE',
  description: 'Viewed individual profile',
  status: 'Success',
  customerName: 'Tan Wei Ling',
  customerId: 'S1234567A',
  ...over,
})

const lastListParams = () => getAuditLogs.mock.calls.at(-1)?.[0] as Record<string, unknown>
const lastExportQuery = () =>
  Object.fromEntries(new URL(remoteDownloadCsv.mock.calls.at(-1)?.[0] as string).searchParams.entries())

beforeEach(() => {
  vi.clearAllMocks()
  getAuditLogs.mockResolvedValue({
    status: 200,
    data: [row(), row({ user: `User ${LEGACY_ID}`, status: 'Failure', customerName: 'Rahman Ali', description: 'Lookup failed' })],
    totalCount: 57,
    totalPages: 6,
  })
  remoteDownloadCsv.mockResolvedValue({ filename: 'x.csv', rowCount: 1, matchCount: 1, truncated: false, rowLimit: 10000 })
})

async function pick(user: ReturnType<typeof userEvent.setup>, column: RegExp, option: string | RegExp) {
  await user.click(screen.getByRole('button', { name: column }))
  await user.click(await screen.findByRole('button', { name: option }))
}

describe('filters are applied by the server', () => {
  it('describes the whole trail in the pager, not the page it holds', async () => {
    render(<AuditLogs />)

    expect(await screen.findByText('Rahman Ali')).toBeInTheDocument()
    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && /of 57 events?/.test(el.textContent ?? ''))).toBeInTheDocument()
  })

  it('sends outcome and customer as query parameters and keeps paging on', async () => {
    const user = userEvent.setup()
    render(<AuditLogs />)
    await screen.findByText('Rahman Ali')

    await pick(user, /^outcome/i, 'Failed')
    await waitFor(() => expect(lastListParams()).toMatchObject({ status: 'FAILED', pageNumber: 1 }))

    await pick(user, /^customer/i, 'Tan Wei Ling')
    await waitFor(() => expect(lastListParams()).toMatchObject({ status: 'FAILED', customer: 'Tan Wei Ling' }))

    // The pager still reports the server's total — it is no longer suppressed while a filter is on.
    expect(screen.getByText((_, el) => el?.tagName === 'SPAN' && /of 57 events?/.test(el.textContent ?? ''))).toBeInTheDocument()
  })

  /** A pre-fix row stores "User <id>"; the server can only match it by that id. */
  it('filters a legacy actor by id', async () => {
    const user = userEvent.setup()
    render(<AuditLogs />)
    await screen.findByText('Rahman Ali')

    await user.click(screen.getByRole('button', { name: /^performed by/i }))
    await user.click(await screen.findByRole('button', { name: new RegExp(LEGACY_ID) }))

    await waitFor(() => expect(lastListParams()).toMatchObject({ actor: LEGACY_ID }))
  })
})

describe('the export', () => {
  it('carries exactly the filters the table was fetched with', async () => {
    const user = userEvent.setup()
    render(<AuditLogs />)
    await screen.findByText('Rahman Ali')
    await pick(user, /^outcome/i, 'Failed')
    await pick(user, /^what happened/i, 'View Profile')
    await waitFor(() => expect(lastListParams()).toMatchObject({ status: 'FAILED', action: 'VIEW' }))

    await user.click(screen.getByRole('button', { name: /export csv/i }))
    await waitFor(() => expect(remoteDownloadCsv).toHaveBeenCalled())

    const { pageNumber: _n, pageSize: _s, ...listed } = lastListParams()
    const sent = Object.fromEntries(Object.entries(listed).filter(([, v]) => v !== undefined))
    expect(lastExportQuery()).toEqual(sent)
  })
})
