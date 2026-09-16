import { QueryClient } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { invalidate, TOPICS } from '../stores/invalidationStore'
import { installInvalidationBridge, TOPIC_QUERY_PREFIXES } from './invalidationBridge'

/**
 * The bridge between live platform events and the query cache.
 *
 * List pages keep stable query keys so that returning to one is a cache hit; the price is that nothing
 * in the key changes when the data does. This bridge is what makes a live update reach the cache
 * anyway. Getting the mapping wrong fails silently in either direction: a missing prefix leaves a page
 * stale until someone presses Refresh, and an over-broad one refetches every list on every event.
 */

let client: QueryClient
let uninstall: () => void

function seed(key: readonly unknown[]) {
  client.setQueryData(key, { seeded: true })
}

function isStale(key: readonly unknown[]) {
  return client.getQueryState(key)?.isInvalidated ?? false
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { staleTime: Infinity } } })
  uninstall = installInvalidationBridge(client)
})

afterEach(() => {
  uninstall()
  client.clear()
})

describe('installInvalidationBridge', () => {
  it('marks only the queries belonging to the topic that changed as stale', () => {
    seed(['auditLogs', 'list', { page: 1 }])
    seed(['systemLogs', 'list', { page: 1 }])
    seed(['users', 'directory', 'page', { page: 1 }])

    invalidate(TOPICS.auditLogs)

    expect(isStale(['auditLogs', 'list', { page: 1 }])).toBe(true)
    expect(isStale(['systemLogs', 'list', { page: 1 }])).toBe(false)
    expect(isStale(['users', 'directory', 'page', { page: 1 }])).toBe(false)
  })

  it('refreshes the approval queue, the sidebar badge and the checker list together', () => {
    seed(['approvals', 'list', {}])
    seed(['approvalSummaryBadge'])
    seed(['assignedApprovals', 'x'])

    invalidate(TOPICS.approvals)

    expect(isStale(['approvals', 'list', {}])).toBe(true)
    expect(isStale(['approvalSummaryBadge'])).toBe(true)
    expect(isStale(['assignedApprovals', 'x'])).toBe(true)
  })

  it('stops reacting once uninstalled', () => {
    seed(['users', 'directory', 'summary'])
    uninstall()

    invalidate(TOPICS.users)

    expect(isStale(['users', 'directory', 'summary'])).toBe(false)
    uninstall = () => {}
  })

  it('has a query prefix for every topic the store can publish', () => {
    for (const topic of Object.values(TOPICS)) {
      expect(TOPIC_QUERY_PREFIXES[topic]?.length ?? 0).toBeGreaterThan(0)
    }
  })
})
