import { renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useActivityTracking } from './useActivityTracking'
import { useAuthStore } from '../../features/auth/store/authStore'
import { auditLogsApi } from '../../features/system-audit-logs/api/auditLogsApi'

let mockPathname = '/dashboard'

vi.mock('react-router-dom', () => ({
  useLocation: () => ({ pathname: mockPathname }),
}))

describe('useActivityTracking', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
    mockPathname = '/dashboard'
  })

  it('does not record activity when user is not authenticated', () => {
    useAuthStore.setState({ status: 'unauthenticated' })
    const spy = vi.spyOn(auditLogsApi, 'recordActivity').mockResolvedValue()

    renderHook(() => useActivityTracking())

    expect(spy).not.toHaveBeenCalled()
  })

  it('records navigation event when user is authenticated', async () => {
    useAuthStore.setState({
      status: 'authenticated',
      accessToken: 'test-token',
      ensureFreshAccessToken: async () => 'test-token',
    })

    const spy = vi.spyOn(auditLogsApi, 'recordActivity').mockResolvedValue()

    renderHook(() => useActivityTracking())

    // Allow promise microtasks to flush
    await new Promise((resolve) => setTimeout(resolve, 10))

    expect(spy).toHaveBeenCalledWith('test-token', expect.objectContaining({
      page: 'dashboard',
      module: 'Dashboard',
      sourceApplication: 'Host',
      action: 'page.viewed',
    }))
  })
})
