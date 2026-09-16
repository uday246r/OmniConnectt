import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { SystemLogDto } from '../../api/systemLogsApi'
import { SystemLogDetailDrawer } from './SystemLogDetailDrawer'

/**
 * A system log explained in words first, identifiers second.
 *
 * The drawer opened on request, correlation, tenant and user GUIDs, which told an operator nothing about
 * what went wrong. These tests hold the new shape: the top describes the event, the raw identifiers are
 * hidden until "Technical details" is opened, each can still be copied, there is exactly one way to
 * close the drawer, and "View Related Logs" still hands over the correlation id without showing it.
 */

const CORRELATION_ID = '6f2c1a9e-8b1d-4f7e-9a44-2b3c4d5e6f70'
const REQUEST_ID = '0HN7-REQUEST-42'
const USER_ID = 'a1b2c3d4-0000-4000-8000-123456789abc'

function log(over: Partial<SystemLogDto> = {}): SystemLogDto {
  return {
    id: 'log-1',
    occurredAt: '2026-09-12T10:00:00Z',
    severity: 'Error',
    serviceName: 'Customer360Service',
    module: 'Profiles',
    environment: 'Production',
    tenantId: null,
    userId: USER_ID,
    correlationId: CORRELATION_ID,
    requestId: REQUEST_ID,
    statusCode: 503,
    eventCode: 'unhandled_exception',
    message: 'The CRM did not answer in time.',
    stackTrace: 'at CrmProxyService.Forward()',
    metadata: '{"path":"/v1/indprofile"}',
    ...over,
  }
}

describe('SystemLogDetailDrawer', () => {
  it('describes the event in words at the top', () => {
    render(<SystemLogDetailDrawer log={log()} onClose={() => {}} />)

    expect(screen.getByText('The CRM did not answer in time.')).toBeVisible()
    expect(screen.getAllByText('Unhandled exception').length).toBeGreaterThan(0)
    expect(screen.getByText('Customer 360 Service')).toBeVisible()
    expect(screen.getByText('Service unavailable (503)')).toBeVisible()
  })

  it('keeps identifiers, the stack trace and metadata collapsed under Technical details', async () => {
    const user = userEvent.setup()
    render(<SystemLogDetailDrawer log={log()} onClose={() => {}} />)

    const details = screen.getByText('Technical details').closest('details')!
    expect(details.open).toBe(false)
    expect(screen.getByText(REQUEST_ID)).not.toBeVisible()
    expect(screen.getByText(CORRELATION_ID)).not.toBeVisible()
    expect(screen.getByText(USER_ID)).not.toBeVisible()

    await user.click(screen.getByText('Technical details'))

    expect(details.open).toBe(true)
    expect(screen.getByText(REQUEST_ID)).toBeVisible()
    expect(screen.getByText('at CrmProxyService.Forward()')).toBeVisible()
    expect(within(details).getByRole('button', { name: 'Copy correlation ID' })).toBeInTheDocument()
    expect(within(details).getByRole('button', { name: 'Copy user ID' })).toBeInTheDocument()
  })

  it('confirms a copy on every identifier, including the user id', async () => {
    const user = userEvent.setup()
    render(<SystemLogDetailDrawer log={log()} onClose={() => {}} />)
    await user.click(screen.getByText('Technical details'))

    await user.click(screen.getByRole('button', { name: 'Copy user ID' }))

    expect(screen.getByRole('button', { name: 'user ID copied' })).toBeInTheDocument()
  })

  it('has one close control and closes on Escape', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    render(<SystemLogDetailDrawer log={log()} onClose={onClose} />)

    expect(screen.getAllByRole('button', { name: /close/i })).toHaveLength(1)
    await user.keyboard('{Escape}')

    expect(onClose).toHaveBeenCalled()
  })

  it('opens related logs by correlation id without printing it', async () => {
    const user = userEvent.setup()
    const onViewRelated = vi.fn()
    const onClose = vi.fn()
    render(<SystemLogDetailDrawer log={log()} onClose={onClose} onViewRelated={onViewRelated} />)

    await user.click(screen.getByRole('button', { name: 'View Related Logs' }))

    expect(onViewRelated).toHaveBeenCalledWith(CORRELATION_ID)
    expect(onClose).toHaveBeenCalled()
  })

  it('omits fields the log does not carry rather than inventing a value', () => {
    render(<SystemLogDetailDrawer log={log({ module: null, statusCode: null, environment: null, stackTrace: null, metadata: null })} onClose={() => {}} />)

    expect(screen.queryByText('Module')).toBeNull()
    expect(screen.queryByText('Request Outcome')).toBeNull()
    expect(screen.queryByText('Environment')).toBeNull()
    expect(screen.queryByText(/stack trace/i)).toBeNull()
  })
})
