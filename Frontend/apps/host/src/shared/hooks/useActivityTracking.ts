import { useEffect, useRef } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuthStore } from '../../features/auth/store/authStore'
import { useNavigationStore } from '../stores/navigationStore'
import { auditLogsApi, type ActivityEventDto } from '../../features/system-audit-logs/api/auditLogsApi'

export interface TrackActivityEvent extends Partial<ActivityEventDto> {
  page?: string
}

export function trackActivity(event: TrackActivityEvent) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('omni:track-activity', { detail: event }))
  }
}

function formatSegmentLabel(seg: string): string {
  if (!seg) return ''
  return seg
    .replace(/[._-]/g, ' ')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

export function resolvePageAndModule(pathname: string): {
  page: string
  module: string
  sourceApplication: string
  pageLabel: string
} {
  const clean = pathname.replace(/^\/+|\/+$/g, '')
  if (!clean || clean === 'dashboard') {
    return { page: 'dashboard', module: 'Dashboard', sourceApplication: 'Host', pageLabel: 'Dashboard' }
  }

  // 1. Try resolving dynamically from navigation sections
  try {
    const sections = useNavigationStore.getState().sections
    const targetRoute = `/${clean}`.toLowerCase()
    for (const section of sections) {
      for (const item of section.items) {
        if (item.routePath.toLowerCase() === targetRoute) {
          return {
            page: item.page || clean.split('/').pop() || item.label,
            module: item.kind === 'remote-app' ? item.label : section.label || 'System',
            sourceApplication: item.kind === 'remote-app' ? item.label : 'Host',
            pageLabel: item.label,
          }
        }
        for (const child of item.children || []) {
          if (child.routePath.toLowerCase() === targetRoute) {
            return {
              page: child.page || child.routePath.split('/').pop() || child.label,
              module: item.label,
              sourceApplication: item.label,
              pageLabel: child.label,
            }
          }
        }
      }
    }
  } catch {
    // Fall back to rule-based parsing below
  }

  // 2. Fallback resolution for known routes or when navigation is still loading
  const parts = clean.split('/')
  if (parts[0] === 'apps') {
    const appKey = parts[1] || 'remote'
    const page = parts[2] || 'index'
    let sourceApp = 'Remote App'
    if (appKey.toLowerCase() === 'lead') {
      sourceApp = 'Lead Management'
    } else if (appKey.toLowerCase() === 'customer360') {
      sourceApp = 'Customer 360'
    } else {
      sourceApp = formatSegmentLabel(appKey)
    }

    let pageLabel = formatSegmentLabel(page)
    if (page === 'view-lead') pageLabel = 'View Leads'
    else if (page === 'create-lead') pageLabel = 'Create Lead'
    else if (page === 'field-settings') pageLabel = 'Field Settings'
    else if (page === 'audit-logs') pageLabel = 'Audit Logs'
    else if (page === 'individual') pageLabel = 'Individual'
    else if (page === 'non-individual') pageLabel = 'Non-Individual'

    return { page, module: sourceApp, sourceApplication: sourceApp, pageLabel }
  }

  if (parts[0] === 'system') {
    const sub = parts[1] || 'system'
    let pageLabel = formatSegmentLabel(sub)
    if (sub === 'audit-logs') pageLabel = 'Audit Logs'
    else if (sub === 'system-logs') pageLabel = 'System Logs'
    else if (sub === 'approvals') pageLabel = 'Approval Center'
    return { page: sub, module: 'System', sourceApplication: 'Host', pageLabel }
  }

  if (parts[0] === 'settings') {
    const sub = parts[1] || 'settings'
    let pageLabel = formatSegmentLabel(sub)
    if (sub === 'users') pageLabel = 'User Management'
    else if (sub === 'roles') pageLabel = 'Role Management'
    else if (sub === 'applications') pageLabel = 'Applications'
    return { page: sub, module: 'Settings', sourceApplication: 'Host', pageLabel }
  }

  if (parts[0] === 'profile') {
    return { page: 'profile', module: 'Profile', sourceApplication: 'Host', pageLabel: 'Profile' }
  }

  if (parts[0] === 'my-requests') {
    return { page: 'my-requests', module: 'System', sourceApplication: 'Host', pageLabel: 'My Requests' }
  }

  return {
    page: clean,
    module: formatSegmentLabel(parts[0]) || 'General',
    sourceApplication: 'Host',
    pageLabel: formatSegmentLabel(parts[parts.length - 1]),
  }
}

export function useActivityTracking() {
  const location = useLocation()
  const status = useAuthStore((s) => s.status)
  const lastTrackedRef = useRef<{ path: string; time: number }>({ path: '', time: 0 })

  // Listen for explicit custom activity events (e.g. details viewed)
  useEffect(() => {
    if (status !== 'authenticated') return

    const handleCustomActivity = (e: Event) => {
      const detail = (e as CustomEvent<TrackActivityEvent>).detail
      if (!detail) return
      const currentToken = useAuthStore.getState().accessToken
      const tokenPromise = currentToken ? Promise.resolve(currentToken) : useAuthStore.getState().ensureFreshAccessToken()
      tokenPromise
        .then((token) => {
          if (!token) return
          auditLogsApi
            .recordActivity(token, {
              page: detail.page || 'details',
              module: detail.module,
              sourceApplication: detail.sourceApplication || 'Host',
              action: detail.action || 'details.viewed',
              actionCategory: detail.actionCategory || 'ViewDetails',
              pageLabel: detail.pageLabel,
              details: detail.details,
              entityType: detail.entityType,
              entityId: detail.entityId,
              entityLabel: detail.entityLabel,
            })
            .catch((err) => {
              if (import.meta.env.DEV) {
                console.warn('[useActivityTracking] Failed to record custom activity:', err)
              }
            })
        })
        .catch(() => {})
    }

    window.addEventListener('omni:track-activity', handleCustomActivity)
    return () => {
      window.removeEventListener('omni:track-activity', handleCustomActivity)
    }
  }, [status])

  // Track page navigation
  useEffect(() => {
    if (status !== 'authenticated') return

    const currentPath = location.pathname
    const now = Date.now()
    // 2-second debounce on the same path
    if (lastTrackedRef.current.path === currentPath && now - lastTrackedRef.current.time < 2000) {
      return
    }
    lastTrackedRef.current = { path: currentPath, time: now }

    const { page, module, sourceApplication, pageLabel } = resolvePageAndModule(currentPath)

    const currentToken = useAuthStore.getState().accessToken
    const tokenPromise = currentToken ? Promise.resolve(currentToken) : useAuthStore.getState().ensureFreshAccessToken()

    tokenPromise
      .then((token) => {
        if (!token) return
        auditLogsApi
          .recordActivity(token, {
            page,
            module,
            sourceApplication,
            pageLabel,
            action: 'page.viewed',
            actionCategory: 'Navigation',
          })
          .catch((err) => {
            if (import.meta.env.DEV) {
              console.warn('[useActivityTracking] Failed to record activity:', err)
            }
          })
      })
      .catch(() => {})
  }, [location.pathname, status])
}
