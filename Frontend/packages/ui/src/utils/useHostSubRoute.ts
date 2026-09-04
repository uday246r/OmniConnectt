import { useEffect, useRef } from 'react'

/**
 * Keeps a remote app's current page in the host's URL.
 *
 * A remote renders at `/apps/:appKey/*` and switches pages from its own store, so without this the
 * URL said only which app was open: `/apps/lead` was the address of the dashboard, the lead
 * directory and the audit trail alike. Refreshing dropped you back on the remote's default page,
 * Back left the app entirely, and no page inside a remote could be linked or bookmarked.
 *
 * The remote cannot call the host's router itself, so this reads and writes through the host bridge's
 * `navigation` API (`window.__omniremitHost__.navigation`). Running standalone — `vite preview`, a
 * remote's own dev server — there is no bridge and this quietly does nothing, so a remote still works
 * outside the shell.
 *
 * Both directions are guarded against feedback: the hook remembers the last value it wrote and the
 * last value it applied, so a write never reads back as a user navigation and vice versa.
 */

interface HostNavigationApi {
  getSubRoute: () => string
  setSubRoute: (subRoute: string, options?: { replace?: boolean }) => void
  onSubRouteChange: (listener: (subRoute: string) => void) => () => void
}

function getHostNavigation(): HostNavigationApi | null {
  if (typeof window === 'undefined') return null
  const bridge = (window as { __omniremitHost__?: { navigation?: HostNavigationApi } }).__omniremitHost__
  return bridge?.navigation ?? null
}

export interface UseHostSubRouteOptions<TPage extends string> {
  /** The remote's current page. */
  page: TPage
  /** Applies a page that came from the URL. */
  setPage: (page: TPage) => void
  /** Every page id the remote can be on; anything else in the URL is ignored as unroutable. */
  pages: readonly TPage[]
}

export function useHostSubRoute<TPage extends string>({ page, setPage, pages }: UseHostSubRouteOptions<TPage>) {
  /**
   * A page applied FROM the URL that the remote's own state has not caught up to yet.
   *
   * Both effects run in the same commit on mount, and at that point `page` is still the store's
   * initial value — so without this the page→URL effect would immediately overwrite the very URL the
   * other effect had just read, and `/apps/lead/audit-logs` would rewrite itself to
   * `/apps/lead/dashboard` before the reader saw anything. It stays set until `page` matches, which
   * is the signal that the store has landed and normal two-way sync can resume.
   */
  const awaitingPageRef = useRef<TPage | null>(null)
  const pagesRef = useRef(pages)
  pagesRef.current = pages
  const setPageRef = useRef(setPage)
  setPageRef.current = setPage
  const pageRef = useRef(page)
  pageRef.current = page

  // URL → page. Runs once on mount for the incoming URL, then on every external change
  // (Back/Forward, or a host link into a specific page).
  useEffect(() => {
    const navigation = getHostNavigation()
    if (!navigation) return

    const applyFromUrl = (subRoute: string) => {
      const next = subRoute as TPage
      if (!subRoute || !pagesRef.current.includes(next)) return
      if (next === pageRef.current) return
      awaitingPageRef.current = next
      setPageRef.current(next)
    }

    applyFromUrl(navigation.getSubRoute())
    return navigation.onSubRouteChange(applyFromUrl)
  }, [])

  // Page → URL.
  useEffect(() => {
    const navigation = getHostNavigation()
    if (!navigation) return

    if (awaitingPageRef.current !== null) {
      // Only stop waiting once the store actually reports the page the URL asked for; anything else
      // in the meantime is a stale render, not a user navigation.
      if (awaitingPageRef.current === page) awaitingPageRef.current = null
      return
    }

    const current = navigation.getSubRoute()
    if (current === page) return

    // The first write replaces: landing on `/apps/lead` and immediately rewriting it to
    // `/apps/lead/dashboard` should not leave a history entry that Back would bounce off.
    navigation.setSubRoute(page, { replace: current === '' })
  }, [page])
}
