import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios'
import { ApiError, ApprovalPendingError, fieldErrorsOf, httpClient, isApprovalPending } from './httpClient'
import { useToastStore } from '../stores/useToastStore'
import type { OmniConnectHostBridge } from '../api/hostBridge'
import { createFakeHostBridge } from '@omniconnect/host-bridge/testing'

/**
 * How this remote talks to its API: who it says it is, and what it does with the platform's answers.
 *
 * It used to send the user's name in `X-Actor-*` headers that the server wrote into the audit trail, and
 * it had no answer for a change held for approval — a 202 read as success, so the screen announced
 * "Product deleted" about a product that was still there. These pin the token-only identity, the
 * approval outcome, and the single refresh-and-retry on an expired token.
 */

function installBridge(over: Partial<OmniConnectHostBridge> = {}) {
  window.__omniconnectHost__ = createFakeHostBridge({
    getAccessToken: () => 'token-1',
    ensureFreshAccessToken: () => Promise.resolve('token-2'),
    getUser: () => null,
    ...over,
  })
}

type Reply = { status: number; data?: unknown }

function respondWith(...replies: Reply[]) {
  const seen: InternalAxiosRequestConfig[] = []
  const adapter: AxiosAdapter = async (config) => {
    seen.push(config)
    const reply = replies[Math.min(seen.length - 1, replies.length - 1)]
    const response = { data: reply.data ?? {}, status: reply.status, statusText: '', headers: {}, config }
    if (reply.status >= 400) {
      const error = Object.assign(new Error(`Request failed with status code ${reply.status}`), { config, response, isAxiosError: true })
      throw error
    }
    return response
  }
  httpClient.defaults.adapter = adapter
  return seen
}

beforeEach(() => {
  useToastStore.setState({ toasts: [] })
})

afterEach(() => {
  delete window.__omniconnectHost__
})

describe('identity', () => {
  it('sends the platform token and nothing that names the user', async () => {
    installBridge()
    const seen = respondWith({ status: 200 })

    await httpClient.get('/products')

    expect(seen[0].headers.Authorization).toBe('Bearer token-1')
    expect(seen[0].headers['X-Actor-Name']).toBeUndefined()
    expect(seen[0].headers['X-Actor-Email']).toBeUndefined()
  })

  it('refreshes an expired token once through the host and repeats the request', async () => {
    const ensureFreshAccessToken = vi.fn(() => Promise.resolve('token-2'))
    installBridge({ ensureFreshAccessToken })
    const seen = respondWith({ status: 401 }, { status: 200, data: { ok: true } })

    const { data } = await httpClient.get('/products')

    expect(data).toEqual({ ok: true })
    expect(ensureFreshAccessToken).toHaveBeenCalledTimes(1)
    expect(seen[1].headers.Authorization).toBe('Bearer token-2')
  })

  it('does not loop when the refreshed token is refused too', async () => {
    installBridge()
    const seen = respondWith({ status: 401 }, { status: 401 })

    await expect(httpClient.get('/products')).rejects.toThrow('Your session has ended')
    expect(seen).toHaveLength(2)
  })

  it('explains a refusal in plain words', async () => {
    installBridge()
    respondWith({ status: 403, data: { title: "You don't have 'Delete' access to products." } })

    await expect(httpClient.delete('/products/1')).rejects.toThrow("You don't have 'Delete' access to products.")
  })
})

describe('a change held for approval', () => {
  const pending = { approvalRequestId: 'req-1', module: 'remote.products.products', action: 'Delete', checkerName: 'Ben Ito', message: 'Request submitted for approval.' }

  it('is not treated as a completed change', async () => {
    installBridge()
    respondWith({ status: 202, data: pending })

    const error = await httpClient.delete('/products/1').catch((e) => e)

    expect(isApprovalPending(error)).toBe(true)
    expect((error as ApprovalPendingError).pending.checkerName).toBe('Ben Ito')
  })

  it('tells the user who has to approve it', async () => {
    installBridge()
    respondWith({ status: 202, data: pending })

    await httpClient.delete('/products/1').catch(() => undefined)

    const toast = useToastStore.getState().toasts.at(-1)
    expect(toast).toMatchObject({ type: 'info', title: 'Sent for approval' })
    expect(toast?.message).toContain('Ben Ito')
  })

  it('leaves an ordinary 202 alone', async () => {
    installBridge()
    respondWith({ status: 202, data: { queued: true } })

    await expect(httpClient.post('/x')).resolves.toMatchObject({ data: { queued: true } })
  })
  it('keeps the per-field messages of a refused save, so a form can mark every field at once', async () => {
    installBridge()
    respondWith({ status: 400, data: { message: '2 fields need attention', errors: { rate: 'rate must be a number.', tenure: 'tenure is required.' } } })

    const error = await httpClient.post('/products', {}).catch((e) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error.message).toBe('2 fields need attention')
    expect(fieldErrorsOf(error)).toEqual({ rate: 'rate must be a number.', tenure: 'tenure is required.' })
  })

  it('reports no field errors for a refusal that is not about fields', async () => {
    installBridge()
    respondWith({ status: 400, data: { message: 'A product with the code "HL_001" already exists.' } })

    const error = await httpClient.post('/products', {}).catch((e) => e)

    expect(error.message).toContain('already exists')
    expect(fieldErrorsOf(error)).toBeUndefined()
    expect(fieldErrorsOf(new Error('anything else'))).toBeUndefined()
  })
})
