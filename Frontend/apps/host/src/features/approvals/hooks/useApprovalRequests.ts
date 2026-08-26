import { useEffect, useState } from 'react'
import { ApiError, isAbortError } from '../../../shared/api/httpClient'
import type { ApprovalRequestListItemDto } from '../api/approvalsApi'

export interface PagedItems {
  items: ApprovalRequestListItemDto[]
  total: number
}

/**
 * Shared fetch/loading/error/cancellation plumbing behind both ApprovalCenterPage and MyRequestsPage —
 * two independent instances (each call site gets its own state), not shared state. Each page supplies
 * its own `fetcher` (which may itself be a multi-call composition, like Approval Center's dual
 * Approved+Rejected merge for its "Processed" tab) and its own `deps` array of whatever filters should
 * trigger a refetch.
 */
export function useApprovalRequests(
  accessToken: string | null | undefined,
  /**
   * Receives an AbortSignal to forward to its API call. Filters, paging and date ranges all change
   * this list rapidly, so superseded requests are cancelled rather than left to finish unread.
   */
  fetcher: (token: string, signal?: AbortSignal) => Promise<PagedItems>,
  deps: unknown[],
) {
  const [items, setItems] = useState<ApprovalRequestListItemDto[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!accessToken) return
    const controller = new AbortController()
    setItems(null)
    setError(null)

    fetcher(accessToken, controller.signal)
      .then((res) => {
        if (controller.signal.aborted) return
        setItems(res.items)
        setTotal(res.total)
      })
      .catch((err) => {
        // An abort is this hook's own doing, not a failure — reporting it would flash "could not
        // load" every time a filter changed.
        if (controller.signal.aborted || isAbortError(err)) return
        setError(err instanceof ApiError ? err.message : 'Could not load approval requests.')
        setItems([])
        setTotal(0)
      })

    return () => {
      controller.abort()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [accessToken, ...deps])

  return { items, total, error }
}
