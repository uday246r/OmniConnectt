import { QueryClient } from '@tanstack/react-query'
import { ApiError } from '../api/httpClient'

/**
 * The app's single QueryClient.
 *
 * Every list/detail page used to hand-roll `useCallback` + `useEffect` + `useState`, which meant no
 * caching, no deduplication, and — because `AbortController` appeared exactly zero times in the
 * whole app — no request cancellation anywhere. Switching tabs or typing in a search box fired
 * overlapping requests whose responses could land out of order, so the last request to *resolve*
 * won rather than the last one *issued*.
 */
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Data is considered fresh for 30s. This is what stops a navigation back to a page you
        // just visited from re-hitting the network, and it is why query keys must NOT contain the
        // access token — see the note in queryKeys.ts.
        staleTime: 30_000,

        // Keep unused data around briefly so back-navigation is instant rather than a fresh spinner.
        gcTime: 5 * 60_000,

        // Refetch when the user returns to the tab. Combined with staleTime this is cheap, and it
        // fixes data being arbitrarily stale after a laptop wakes from sleep.
        refetchOnWindowFocus: true,
        refetchOnReconnect: true,

        retry: (failureCount, error) => {
          // Never retry a request the server has definitively rejected. Retrying a 401/403/404
          // cannot succeed and only delays the real error reaching the user — and for a 401 it
          // would race the refresh-and-retry already happening in httpClient.
          if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
            return false
          }
          return failureCount < 2
        },
      },
      mutations: {
        // Mutations are never retried automatically: they are not guaranteed idempotent, and
        // silently re-sending a create could duplicate a record.
        retry: false,
      },
    },
  })
}

export const appQueryClient = createQueryClient()

