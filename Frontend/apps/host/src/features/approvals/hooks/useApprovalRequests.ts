import { useEffect, useRef, useState } from 'react'
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
 *
 * `silentDeps` are dependencies (like dataRevision or polling ticks) that trigger a refetch without
 * flashing the table to a skeleton (`setItems(null)`).
 */
export function useApprovalRequests(
  accessToken: string | null | undefined,
  /**
   * Receives an AbortSignal to forward to its API call. Filters, paging and date ranges all change
   * this list rapidly, so superseded requests are cancelled rather than left to finish unread.
   */
  fetcher: (token: string, signal?: AbortSignal) => Promise<PagedItems>,
  deps: unknown[],
  silentDeps: unknown[] = [],
) {
  const [items, setItems] = useState<ApprovalRequestListItemDto[] | null>(null)
  const [total, setTotal] = useState(0)
  const [error, setError] = useState<string | null>(null)
  const prevDepsRef = useRef<unknown[] | null>(null)

  useEffect(() => {
    if (!accessToken) return
    const controller = new AbortController()

    /*
     * Only a change the USER made blanks the table.
     *
     * A server push (or a polling tick) arrives through `silentDeps` and re-runs this effect just
     * like a filter change would, but it is a background revalidation — blanking to a skeleton
     * there means a table someone is reading flashes empty at random. Comparing the active `deps`
     * against their previous values distinguishes the two: only a genuine filter/page/refresh
     * change clears the rows.
     */
    const activeDepsChanged =
      prevDepsRef.current === null ||
      prevDepsRef.current.length !== deps.length ||
      deps.some((dep, i) => dep !== prevDepsRef.current![i])

    prevDepsRef.current = deps

    if (activeDepsChanged) {
      setItems(null)
    }
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
  }, [accessToken, ...deps, ...silentDeps])

  return { items, total, error }
}
