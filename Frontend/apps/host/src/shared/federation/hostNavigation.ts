/**
 * Sub-route plumbing shared by the host router and every remote app.
 *
 * A remote renders at `/apps/:appKey` and switches its own internal pages from local state, so the
 * URL used to say only WHICH APP was open and never which page inside it: `/apps/lead` read exactly
 * the same on the dashboard, the lead directory and the audit trail. That costs a refresh (you land
 * back on the remote's default page), a shareable link, the browser Back button, and any bookmark
 * deeper than an app's front door.
 *
 * The host owns the router, and a federated remote cannot call the host's `navigate()` directly, so
 * this module is the seam between them: `HostRouterBridge` registers React Router's navigate here on
 * mount, and the host bridge's `navigation` API (see hostBridge.ts) delegates to it. Reads fall back
 * to `window.location`, so a remote asking where it is before the bridge connects still gets a true
 * answer rather than an empty one.
 */

type NavigateFn = (to: string, options?: { replace?: boolean }) => void

let navigateImpl: NavigateFn | null = null
const listeners = new Set<(subRoute: string) => void>()
let lastPublished: string | null = null

/** Matches `/apps/<appKey>` and captures everything after it. */
const APP_PATH = /^\/apps\/([^/]+)(?:\/(.*))?$/

interface ParsedAppPath {
  appKey: string
  subRoute: string
}

/** Splits a pathname into its remote app key and the sub-route inside that app, if it is one. */
export function parseAppPath(pathname: string): ParsedAppPath | null {
  const match = APP_PATH.exec(pathname)
  if (!match) return null
  return {
    appKey: match[1],
    // Trailing slashes and empty segments both mean "the app's own root".
    subRoute: (match[2] ?? '').replace(/\/+$/, ''),
  }
}

/** Called by HostRouterBridge once the router is mounted. */
export function connectHostRouter(navigate: NavigateFn) {
  navigateImpl = navigate
}

/**
 * Called by HostRouterBridge on every location change, so a remote hears about Back/Forward and any
 * host-driven navigation. Deduped: React re-renders the bridge more often than the path changes, and
 * a remote that re-applied an identical sub-route would fight its own state updates.
 */
export function publishLocation(pathname: string) {
  const subRoute = parseAppPath(pathname)?.subRoute ?? ''
  if (subRoute === lastPublished) return
  lastPublished = subRoute
  for (const listener of listeners) listener(subRoute)
}

/** The sub-route currently in the URL, or '' when the remote is at its own root. */
export function readSubRoute(): string {
  return parseAppPath(window.location.pathname)?.subRoute ?? ''
}

/**
 * Writes a sub-route into the URL without remounting the remote — `/apps/:appKey/*` is a single
 * route, so changing the tail re-renders nothing above the remote's own components.
 *
 * A no-op when the current URL is not a remote app path: a remote that has already been navigated
 * away from must not be able to drag the URL back to itself as it unmounts.
 */
export function writeSubRoute(subRoute: string, options?: { replace?: boolean }) {
  const current = parseAppPath(window.location.pathname)
  if (!current) return

  const clean = subRoute.replace(/^\/+|\/+$/g, '')
  if (clean === current.subRoute) return

  const target = clean ? `/apps/${current.appKey}/${clean}` : `/apps/${current.appKey}`
  if (navigateImpl) {
    navigateImpl(target, { replace: options?.replace })
  } else {
    // Before the router connects (or in a standalone remote with no host at all), keep the address
    // bar honest anyway. React Router is not listening yet, so there is nothing to desync.
    window.history[options?.replace ? 'replaceState' : 'pushState'](null, '', target)
  }
}

/** Subscribe to sub-route changes that came from outside the remote. Returns an unsubscribe. */
export function subscribeSubRoute(listener: (subRoute: string) => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
