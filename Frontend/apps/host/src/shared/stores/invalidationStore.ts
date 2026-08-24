import { create } from 'zustand'

/**
 * One app-wide "this data changed, re-read it" signal.
 *
 * This was previously `mutationCount` on `settingsDrawerStore`, which coupled cache invalidation to
 * the Settings drawer's UI state. Anything outside the drawer therefore had no way to publish, and
 * `ApprovalCenterPage` demonstrated the cost: its approve/reject handlers dispatched a
 * `omniremit:approval-count-invalidated` window event that had **zero listeners anywhere in the
 * repo**, so approving a request left the bell badge, the approvals menu, the Approval Center table
 * and My Requests' "Get password" button all stale until a 60s poll or a window refocus.
 *
 * Deliberately transport-agnostic. Today `invalidate()` is called directly by the code that
 * performed the mutation. When SignalR arrives, the server push handler calls exactly the same
 * function and every consumer below updates unchanged — no consumer knows or cares where the signal
 * originated.
 *
 * Topics exist so a user edit does not force the applications list to refetch. `invalidate()` with
 * no arguments bumps everything, which is the right call when the blast radius is genuinely unknown.
 */

export const TOPICS = {
  users: 'users',
  roles: 'roles',
  applications: 'applications',
  checkerAssignments: 'checker-assignments',
  /** Approval requests, the pending-count badge, and the approvals menu. */
  approvals: 'approvals',
} as const

export type InvalidationTopic = (typeof TOPICS)[keyof typeof TOPICS]

const ALL_TOPICS = Object.values(TOPICS) as InvalidationTopic[]

const zeroed = () =>
  ALL_TOPICS.reduce<Record<string, number>>((acc, t) => {
    acc[t] = 0
    return acc
  }, {})

interface InvalidationState {
  /** Bumped by every invalidation, whatever its topic. Consumers that cannot scope themselves use this. */
  global: number
  revisions: Record<string, number>
  /** Publish a change. With no topics, invalidates everything. */
  invalidate: (...topics: InvalidationTopic[]) => void
}

export const useInvalidationStore = create<InvalidationState>((set) => ({
  global: 0,
  revisions: zeroed(),

  invalidate: (...topics) =>
    set((s) => {
      const affected = topics.length > 0 ? topics : ALL_TOPICS
      const revisions = { ...s.revisions }
      for (const t of affected) {
        revisions[t] = (revisions[t] ?? 0) + 1
      }
      return { global: s.global + 1, revisions }
    }),
}))

/**
 * Subscribe to a topic's revision number. Put the result in a `useEffect` dependency array (or a
 * query key) and the effect re-runs whenever that topic is invalidated.
 *
 * Omit the topic to track every change.
 */
export function useDataRevision(topic?: InvalidationTopic): number {
  return useInvalidationStore((s) => (topic ? (s.revisions[topic] ?? 0) : s.global))
}

/**
 * Publish from outside React — event handlers, API-client interceptors, or a future SignalR
 * connection. Reads the action off the store rather than closing over it, so it is always current.
 */
export function invalidate(...topics: InvalidationTopic[]): void {
  useInvalidationStore.getState().invalidate(...topics)
}
