import type { QueryClient } from '@tanstack/react-query'
import { useInvalidationStore, type InvalidationTopic } from '../stores/invalidationStore'
import { useRealtimeConnected } from '../realtime/platformConnection'

/**
 * Which cached queries each live-update topic makes stale, by query-key prefix.
 *
 * A topic lists every prefix whose data it can change. Keep this next to `queryKeys.ts`: a new cached
 * list that is missing here keeps showing old rows after someone else changes them.
 */
export const TOPIC_QUERY_PREFIXES: Record<InvalidationTopic, readonly (readonly string[])[]> = {
  users: [['users']],
  roles: [['roles']],
  applications: [['applications']],
  'checker-assignments': [['checkerAssignments']],
  approvals: [['approvals'], ['approvalSummaryBadge'], ['assignedApprovals']],
  'audit-logs': [['auditLogs'], ['securityAlerts']],
  'system-logs': [['systemLogs']],
  kpis: [['dashboard']],
}

/**
 * Connects live updates (SignalR events, and local changes that call `invalidate`) to the query cache.
 *
 * @remarks
 * The list pages used to put a revision number in their query keys, so every update minted a new cache
 * entry and orphaned the old one, and a page opened again after navigating away started from an empty
 * key. With this bridge the keys describe only WHAT is fetched: going back to a page is an instant hit
 * on the cached rows, and an update marks exactly the affected queries stale — refetched at once if on
 * screen, on the next visit if not.
 *
 * Returns an unsubscribe function. Installed once, in `main.tsx`.
 */
export function installInvalidationBridge(queryClient: QueryClient): () => void {
  let previous = useInvalidationStore.getState().revisions

  return useInvalidationStore.subscribe((state) => {
    const changed = (Object.keys(state.revisions) as InvalidationTopic[]).filter(
      (topic) => state.revisions[topic] !== previous[topic],
    )
    previous = state.revisions

    for (const topic of changed) {
      for (const queryKey of TOPIC_QUERY_PREFIXES[topic] ?? []) {
        void queryClient.invalidateQueries({ queryKey: [...queryKey] })
      }
    }
  })
}

/**
 * How often a cached list should poll: never while live updates are connected, every `intervalMs`
 * while they are not — so a blocked WebSocket never leaves a screen silently stale.
 */
export function useLiveRefetchInterval(intervalMs = 60_000): number | false {
  return useRealtimeConnected() ? false : intervalMs
}
