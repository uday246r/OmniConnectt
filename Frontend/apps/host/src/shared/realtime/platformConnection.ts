import * as signalR from '@microsoft/signalr'
import { create } from 'zustand'
import { env } from '../../config/env'
import { useAuthStore } from '../../features/auth/store/authStore'
import { invalidate, TOPICS, type InvalidationTopic } from '../stores/invalidationStore'
import { appQueryClient } from '../query/queryClient'
import { useNavigationStore } from '../stores/navigationStore'
import type { ApprovalSummaryDto } from '../../features/approvals/api/approvalsApi'

interface RealtimeState {
  connected: boolean
  setConnected: (connected: boolean) => void
}

export const useRealtimeStore = create<RealtimeState>((set) => ({
  connected: false,
  setConnected: (connected) => set({ connected }),
}))

export const useRealtimeConnected = () => useRealtimeStore((s) => s.connected)

interface PlatformEventPayload {
  topic: string
  action?: string
  data?: any
}

let connection: signalR.HubConnection | null = null
let isStarting = false
let retryTimer: ReturnType<typeof setTimeout> | null = null

// 400ms trailing-edge coalescer for invalidations
const pendingTopics = new Set<InvalidationTopic>()
let coalesceTimer: ReturnType<typeof setTimeout> | null = null

function scheduleInvalidate(topic?: InvalidationTopic) {
  if (!topic) {
    invalidate()
    return
  }
  pendingTopics.add(topic)
  if (coalesceTimer) clearTimeout(coalesceTimer)
  coalesceTimer = setTimeout(() => {
    const toFlush = Array.from(pendingTopics)
    pendingTopics.clear()
    coalesceTimer = null
    if (toFlush.length > 0) {
      invalidate(...toFlush)
    }
  }, 400)
}

// A release promotes several remotes in a row; one tree read after the last of them is enough.
let navigationTimer: ReturnType<typeof setTimeout> | null = null
function scheduleNavigationRefresh() {
  if (navigationTimer) clearTimeout(navigationTimer)
  navigationTimer = setTimeout(() => {
    navigationTimer = null
    void useNavigationStore.getState().refresh()
  }, 400)
}

const retryDelays = [0, 2000, 5000, 10000, 30000]
const retryPolicy: signalR.IRetryPolicy = {
  nextRetryDelayInMilliseconds(retryContext) {
    const attempt = retryContext.previousRetryCount
    if (attempt >= retryDelays.length) return 30000
    if (attempt === 0) {
      // Jitter attempt 0 by 0..3000ms so a deploy doesn't produce a synchronised herd
      return Math.floor(Math.random() * 3000)
    }
    return retryDelays[attempt]
  },
}

export async function startPlatformConnection(): Promise<void> {
  if (!env.realtimeEnabled) return
  if (
    connection &&
    (connection.state === signalR.HubConnectionState.Connected ||
      connection.state === signalR.HubConnectionState.Connecting)
  ) {
    return
  }
  if (isStarting) return
  isStarting = true

  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }

  try {
    if (!connection) {
      connection = new signalR.HubConnectionBuilder()
        .withUrl(`${env.authServiceUrl}/hubs/platform`, {
          accessTokenFactory: () => useAuthStore.getState().ensureFreshAccessToken(),
        })
        .withAutomaticReconnect(retryPolicy)
        .build()

      connection.on('platformEvent', (payload: PlatformEventPayload) => {
        if (!payload?.topic) return
        console.log('[SignalR] Received platformEvent:', payload)

        // 1. Direct Badge update via React Query
        if (
          payload.topic === TOPICS.approvals &&
          payload.action === 'badge' &&
          payload.data?.assignedToMePending !== undefined
        ) {
          const pending = payload.data.assignedToMePending as number
          appQueryClient.setQueriesData<ApprovalSummaryDto>(
            { queryKey: ['approvalSummaryBadge'] },
            (old) => (old ? { ...old, assignedToMePending: pending } : old),
          )
        }

        // 2. The navigation tree is not a query; it is re-read directly, once per burst of changes.
        if (payload.topic === TOPICS.navigation) {
          scheduleNavigationRefresh()
        }

        // 3. Invalidation routing through 400ms coalescer
        const validTopic = (Object.values(TOPICS) as string[]).find((t) => t === payload.topic) as
          | InvalidationTopic
          | undefined
        if (validTopic) {
          scheduleInvalidate(validTopic)
        }
      })

      connection.onreconnected((connectionId) => {
        console.log('[SignalR] Reconnected. Connection ID:', connectionId)
        useRealtimeStore.getState().setConnected(true)
        // Consistency backstop: invalidate all topics when the missed window is unknown
        invalidate()
        scheduleNavigationRefresh()
      })

      connection.onreconnecting((error) => {
        console.warn('[SignalR] Connection lost, reconnecting...', error)
        useRealtimeStore.getState().setConnected(false)
      })

      connection.onclose((error) => {
        console.warn('[SignalR] Connection closed.', error)
        useRealtimeStore.getState().setConnected(false)
      })
    }

    console.log(`[SignalR] Connecting to ${env.authServiceUrl}/hubs/platform...`)
    await connection.start()
    console.log('[SignalR] Connected successfully. Connection ID:', connection.connectionId)
    useRealtimeStore.getState().setConnected(true)
  } catch (err) {
    console.error('[SignalR] Initial connection failed:', err)
    useRealtimeStore.getState().setConnected(false)

    // Retry initial connection if user is still authenticated (SignalR auto-reconnect only works after 1st connect)
    if (useAuthStore.getState().status === 'authenticated') {
      retryTimer = setTimeout(() => {
        retryTimer = null
        void startPlatformConnection()
      }, 5000)
    }
  } finally {
    isStarting = false
  }
}

export async function stopPlatformConnection(): Promise<void> {
  if (retryTimer) {
    clearTimeout(retryTimer)
    retryTimer = null
  }
  if (!connection) return
  try {
    await connection.stop()
  } catch {
  } finally {
    useRealtimeStore.getState().setConnected(false)
  }
}
