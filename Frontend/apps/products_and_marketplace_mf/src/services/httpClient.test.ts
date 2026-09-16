import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios'
import { ApprovalPendingError, httpClient, isApprovalPending } from './httpClient'
import { useDrawerStore } from '../stores/useDrawerStore'
import { useToastStore } from '../stores/useToastStore'
import type { OmniRemitHostBridge } from '../api/hostBridge'

/**
 * How this remote talks to its API: who it says it is, and what it does with the platform's answers.
 *
 * It used to send the user's name in `X-Actor-*` headers that the server wrote into the audit trail, and
 * it had no answer for a change held for approval — a 202 read as success, so the screen announced
 * "Product deleted" about a product that was still there. These pin the token-only identity, the
 * approval outcome, and the single refresh-and-retry on an expired token.
 */

function installBridge(over: Partial<OmniRemitHostBridge> = {}) {
  window.__omniremitHost__ = {
    getAccessToken: () => 'token-1',
    ensureFreshAccessToken: () => Promise.resolve('token-2'),
    hasCapability: () => false,
    getUser: () => null,
    ...over,
  }
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
  useDrawerStore.setState({ isOpen: false, type: null, payload: null })
})

afterEach(() => {
  delete window.__omniremitHost__
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

  it('tells the user who has to approve it and closes the form', async () => {
    installBridge()
    useDrawerStore.setState({ isOpen: true, type: 'product-form', payload: null })
    respondWith({ status: 202, data: pending })

    await httpClient.delete('/products/1').catch(() => undefined)

    const toast = useToastStore.getState().toasts.at(-1)
    expect(toast).toMatchObject({ type: 'info', title: 'Sent for approval' })
    expect(toast?.message).toContain('Ben Ito')
    expect(useDrawerStore.getState().isOpen).toBe(false)
  })

  it('leaves an ordinary 202 alone', async () => {
    installBridge()
    respondWith({ status: 202, data: { queued: true } })

    await expect(httpClient.post('/x')).resolves.toMatchObject({ data: { queued: true } })
  })
})
