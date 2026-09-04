import { useEffect } from 'react'
import { env } from '../../config/env'
import { registerSessionCleanup, useAuthStore } from '../../features/auth/store/authStore'
import { startPlatformConnection, stopPlatformConnection } from './platformConnection'

/**
 * Mounted once at the shell level. Initializes the real-time SignalR connection when
 * authenticated, and registers socket teardown with session cleanup on logout.
 *
 * Idempotent: safe against React 19 StrictMode double-invocations.
 */
export function usePlatformConnection() {
  const status = useAuthStore((s) => s.status)

  useEffect(() => {
    if (status !== 'authenticated' || !env.realtimeEnabled) {
      return
    }

    void startPlatformConnection()

    const unregister = registerSessionCleanup(() => {
      void stopPlatformConnection()
    })

    return () => {
      unregister()
    }
  }, [status])
}
