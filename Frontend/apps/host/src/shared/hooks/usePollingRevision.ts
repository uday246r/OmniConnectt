import { useEffect, useState } from 'react'

/**
 * Fallback polling hook that advances a revision counter every intervalMs,
 * active only when document.visibilityState is 'visible' to avoid background tab overhead.
 */
export function usePollingRevision(intervalMs: number, enabled: boolean = true): number {
  const [revision, setRevision] = useState(0)

  useEffect(() => {
    if (!enabled) return

    const tick = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        setRevision((r) => r + 1)
      }
    }

    const timer = setInterval(tick, intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs, enabled])

  return revision
}
