import { keepPreviousData, useQuery } from '@tanstack/react-query'
import { ApiError } from '../../../shared/api/httpClient'
import { useLiveRefetchInterval } from '../../../shared/query/invalidationBridge'
import type { ApprovalRequestListItemDto } from '../api/approvalsApi'

export interface PagedItems {
  items: ApprovalRequestListItemDto[]
  total: number
}

/**
 * The approval list behind both ApprovalCenterPage and MyRequestsPage, as a cached query.
 *
 * @remarks
 * `queryKey` describes what is shown (the filters and the page). Coming back to the page renders the
 * cached rows at once and revalidates in the background; a live update — or a decision made here —
 * marks the key stale through the invalidation bridge, and the table refreshes in place. While a new
 * filter or page is loading, the previous rows stay on screen rather than flashing to a skeleton.
 *
 * It used to be hand-rolled state that started empty on every visit, with a "silent deps" mechanism to
 * tell a user's filter change from a server push; stable keys make that distinction unnecessary.
 */
export function useApprovalRequests(
  accessToken: string | null | undefined,
  queryKey: readonly unknown[],
  /** Receives the AbortSignal React Query cancels a superseded request with. */
  fetcher: (token: string, signal?: AbortSignal) => Promise<PagedItems>,
) {
  const refetchInterval = useLiveRefetchInterval()
  const query = useQuery({
    queryKey,
    enabled: Boolean(accessToken),
    placeholderData: keepPreviousData,
    refetchInterval,
    queryFn: ({ signal }) => fetcher(accessToken!, signal),
  })

  const error = query.isError
    ? query.error instanceof ApiError ? query.error.message : 'Could not load approval requests.'
    : null

  return {
    items: query.isError ? [] : (query.data?.items ?? null),
    total: query.data?.total ?? 0,
    error,
  }
}
