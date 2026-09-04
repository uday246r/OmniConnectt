import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useLiveRevision } from './useLiveRevision'
import { TOPICS, invalidate } from '../stores/invalidationStore'
import { useRealtimeStore } from '../realtime/platformConnection'

/**
 * The refresh path, which must not depend on the WebSocket surviving.
 *
 * Moving to SignalR removed `refetchInterval` from the queries that had it, and the replacement hook
 * was written but never wired to anything — so real-time became the *only* way a view learned it was
 * out of date. A blocked upgrade, a proxy that strips it, or a failed negotiate, and the approvals
 * and security views sat permanently stale with nothing on screen saying so.
 *
 * These tests pin both halves: push is used when it works, and a timer takes over when it does not.
 */

function setConnected(connected: boolean) {
  act(() => {
    useRealtimeStore.setState({ connected })
  })
}

beforeEach(() => {
  vi.useFakeTimers()
  setConnected(true)
})

afterEach(() => {
  vi.useRealTimers()
})

describe('when the socket is connected', () => {
  it('advances on a pushed event for its topic', () => {
    const { result } = renderHook(() => useLiveRevision(TOPICS.approvals))
    const before = result.current

    act(() => {
      invalidate(TOPICS.approvals)
    })

    expect(result.current).toBeGreaterThan(before)
  })

  it('does not advance on a timer, so a healthy connection costs no extra requests', () => {
    const { result } = renderHook(() => useLiveRevision(TOPICS.approvals, 60_000))
    const before = result.current

    act(() => {
      vi.advanceTimersByTime(5 * 60_000)
    })

    expect(result.current).toBe(before)
  })

  it('ignores a pushed event for a different topic', () => {
    const { result } = renderHook(() => useLiveRevision(TOPICS.approvals))
    const before = result.current

    act(() => {
      invalidate(TOPICS.auditLogs)
    })

    expect(result.current).toBe(before)
  })
})

describe('when the socket is down', () => {
  it('advances on a timer, so the view still refreshes', () => {
    // The whole point. Without this the page is stale until the user reloads it by hand.
    setConnected(false)
    const { result } = renderHook(() => useLiveRevision(TOPICS.approvals, 60_000))
    const before = result.current

    act(() => {
      vi.advanceTimersByTime(60_000)
    })

    expect(result.current).toBeGreaterThan(before)
  })

  it('keeps advancing on each interval', () => {
    setConnected(false)
    const { result } = renderHook(() => useLiveRevision(TOPICS.approvals, 60_000))
    const before = result.current

    act(() => {
      vi.advanceTimersByTime(3 * 60_000)
    })

    expect(result.current).toBe(before + 3)
  })

  it('stops polling as soon as the socket comes back', () => {
    setConnected(false)
    const { result } = renderHook(() => useLiveRevision(TOPICS.approvals, 60_000))

    act(() => {
      vi.advanceTimersByTime(60_000)
    })
    const afterOneTick = result.current

    setConnected(true)
    act(() => {
      vi.advanceTimersByTime(5 * 60_000)
    })

    expect(result.current).toBe(afterOneTick)
  })

  it('does not poll a hidden tab', () => {
    // A backgrounded tab with a dead socket should not spend the interval refetching data nobody is
    // looking at; it catches up when the tab is next visible.
    setConnected(false)
    const visibility = vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('hidden')

    const { result } = renderHook(() => useLiveRevision(TOPICS.approvals, 60_000))
    const before = result.current

    act(() => {
      vi.advanceTimersByTime(3 * 60_000)
    })

    expect(result.current).toBe(before)
    visibility.mockRestore()
  })
})
