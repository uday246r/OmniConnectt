import { useEffect } from 'react'
import { useLocation } from 'react-router-dom'
import { useAuthStore } from '../../features/auth/store/authStore'
import { auditLogsApi } from '../../features/system-audit-logs/api/auditLogsApi'
import { findAppNode, findNodeByRoute, type NavSectionDto } from '../api/navigationApi'
import { useNavigationStore } from '../stores/navigationStore'

/** How long a route has to stay put to count as opened — long enough to skip a redirect chain. */
export const PAGE_VIEW_SETTLE_MS = 800

/** Routes that are never a page someone opened: public screens, and addresses that only redirect. */
const NEVER_A_PAGE = new Set([
  '/login', '/set-password', '/forgot-password', '/reset-password',
  '/404', '/maintenance-preview', '/settings',
])

/**
 * Settings drawer tabs are pages people open; the forms stacked on top of them (a role being edited,
 * a user being created) are not separate visits.
 */
const DRAWER_FORM = /^\/settings\/(users\/new|roles\/.+|applications\/.+|checker-assignment\/.+)$/

/**
 * Whether a route is worth reporting as a page view, as far as the browser can tell.
 *
 * The server makes the real decision — it refuses anything that is not a page this user can open — so
 * this only avoids sending what is obviously not a visit: a redirect that is about to replace itself,
 * a form layered on a drawer, or an app that is showing its maintenance notice instead of a page.
 */
export function isTrackablePage(pathname: string, sections: NavSectionDto[]): boolean {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname
  if (NEVER_A_PAGE.has(path) || DRAWER_FORM.test(path)) return false

  // /apps/lead is only ever on screen long enough to redirect to the app's first page.
  const appRoot = /^\/apps\/([^/]+)$/.exec(path)
  if (appRoot) {
    const app = findAppNode(sections, appRoot[1])
    if (!app || app.remote?.defaultRoutePath) return false
  }

  const node = findNodeByRoute(sections, path)
  return node?.state !== 'maintenance'
}

/**
 * Records every page the signed-in person opens in the platform audit trail.
 *
 * Mounted once, in the authenticated shell. Remote apps need nothing of their own: every page change
 * inside a remote is a change of the host's address, so this sees it.
 *
 * Fire-and-forget by design. Recording a visit must never slow down, block or break the visit itself,
 * so failures — including the server refusing the route, or the per-user rate limit — are swallowed.
 * The server also deduplicates, so a refresh or a quick back-and-forth is one row.
 */
export function usePageViewTracking(): void {
  const { pathname } = useLocation()
  const status = useAuthStore((s) => s.status)
  const ensureFreshAccessToken = useAuthStore((s) => s.ensureFreshAccessToken)
  const navStatus = useNavigationStore((s) => s.status)
  const sections = useNavigationStore((s) => s.sections)

  // Waiting for the tree matters: before it arrives an app root cannot be told apart from a redirect.
  const ready = status === 'authenticated' && navStatus === 'loaded'

  useEffect(() => {
    if (!ready || !isTrackablePage(pathname, sections)) return

    const timer = setTimeout(() => {
      void ensureFreshAccessToken()
        .then((token) => auditLogsApi.recordPageView(token, pathname))
        .catch(() => {
          // Never surfaced: see above.
        })
    }, PAGE_VIEW_SETTLE_MS)

    return () => clearTimeout(timer)
    // `sections` is deliberately not a dependency: a tree refresh is not a new visit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, pathname, ensureFreshAccessToken])
}
