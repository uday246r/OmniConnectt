import { useDataRevision, type InvalidationTopic } from '../stores/invalidationStore'
import { useRealtimeConnected } from '../realtime/platformConnection'
import { usePollingRevision } from './usePollingRevision'

/**
 * A revision counter that advances when a topic changes, however the client found out.
 *
 * Two sources, and the caller is not told which answered. The push revision advances when the server
 * sends a `platformEvent` for this topic. The polling revision advances on a timer — but **only while
 * the socket is not connected**, so a healthy connection costs nothing and a broken one still
 * refreshes.
 *
 * This exists because moving to SignalR removed the `refetchInterval: 60_000` from the queries that
 * had it, and the replacement was written but never wired to anything. That left real-time as the
 * only refresh path: a blocked WebSocket, a proxy that strips upgrades, or a failed negotiate and the
 * approvals and security views sat permanently stale with nothing on screen saying so. Push is the
 * fast path; it must not be the only one.
 *
 * Deliberately not a `refetchInterval` on each query: the revision is part of the query key, so a
 * bump refetches through the same path a pushed event does. One mechanism, one behaviour to reason
 * about, and the interval disappears the moment the socket comes back.
 */
export function useLiveRevision(topic: InvalidationTopic, intervalMs = 60_000): number {
  const pushRevision = useDataRevision(topic)
  const connected = useRealtimeConnected()

  // `usePollingRevision` already skips ticks while the tab is hidden, so a backgrounded tab with a
  // dead socket does not spend the interval refetching data nobody is looking at.
  const pollRevision = usePollingRevision(intervalMs, !connected)

  // Summed rather than combined into a string: either source advancing produces a new key, and the
  // value stays a number, which is what the query keys already expect.
  return pushRevision + pollRevision
}
