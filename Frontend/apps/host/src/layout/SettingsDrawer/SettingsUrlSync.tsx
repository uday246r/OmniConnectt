import { useEffect, useRef } from 'react'
import { useLocation, useNavigate, type Location } from 'react-router-dom'
import { useSettingsDrawerStore } from '../../shared/stores/settingsDrawerStore'
import { isSameLayer, settingsPathFor, settingsStateFor } from './settingsRoutePath'

/**
 * Keeps the settings drawer and the address bar in step, in both directions. Renders nothing.
 *
 * Mounted once inside the router (App.tsx, deliberately OUTSIDE `<Routes>` — see the comment there)
 * because the drawer is a global overlay rather than a routed page: it can be opened over the
 * dashboard, the audit log or a remote app, and closing it has to put the reader back exactly where
 * they were.
 *
 * The page UNDERNEATH never re-mounts while the drawer is open: navigation carries that page's own
 * location in `state.backgroundLocation`, and AppRoutes matches its `<Routes>` against that instead
 * of the live one (React Router's standard modal-route recipe).
 *
 * EACH DIRECTION DEPENDS ON ONE SIDE ONLY, and that is load-bearing rather than stylistic. The
 * URL→drawer effect keys off the location; the drawer→URL effect keys off store state and reads the
 * path imperatively from `window.location`. An earlier version had both effects depending on both
 * sides: they then ran in the same commit off each other's pre-update values, each "correcting" what
 * the other had just written, and Back out of a form ping-ponged until React threw "Maximum update
 * depth exceeded". With the dependencies split, a write on one side can only ever trigger a single
 * idempotent pass on the other.
 */
export function SettingsUrlSync() {
  const navigate = useNavigate()
  const location = useLocation()

  const isOpen = useSettingsDrawerStore((s) => s.isOpen)
  const activeTab = useSettingsDrawerStore((s) => s.activeTab)
  const layerStack = useSettingsDrawerStore((s) => s.layerStack)
  const open = useSettingsDrawerStore((s) => s.open)
  const close = useSettingsDrawerStore((s) => s.close)
  const pushLayer = useSettingsDrawerStore((s) => s.pushLayer)
  const resetToRoot = useSettingsDrawerStore((s) => s.resetToRoot)

  /** The page the drawer was opened over, restored on close. */
  const backgroundRef = useRef<Location | null>(null)
  /**
   * Whether this component has actually SEEN the drawer open.
   *
   * Without it, the very first run of the drawer→URL effect on a cold `/settings/roles` load reads
   * the store's initial `isOpen: false` — the URL→drawer effect opens the drawer in the same commit,
   * but from a later value — and "restores" the URL to `/`, which the other effect then undoes, and
   * the two oscillate until React gives up with "Maximum update depth exceeded". Only a genuine
   * open→closed transition should hand the URL back.
   */
  const wasOpenRef = useRef(false)
  /** Latest location, for the drawer→URL effect to read without depending on it. */
  const locationRef = useRef(location)
  locationRef.current = location
  /**
   * Same reason, and less obvious: `useNavigate()` hands back a NEW function identity on every
   * location change. Listing it in the drawer→URL effect's dependencies therefore re-ran that effect
   * on navigation — with a `layerStack` from before the URL→drawer effect had updated it — so Back
   * out of a form immediately rewrote the URL back to the form. Held in a ref, the effect depends on
   * drawer state and nothing else.
   */
  const navigateRef = useRef(navigate)
  navigateRef.current = navigate

  // ── URL → drawer ──────────────────────────────────────────────────────────
  // A pasted link, a refresh, Back/Forward, or any navigation away from the drawer.
  useEffect(() => {
    const urlState = settingsStateFor(location.pathname)

    if (!urlState) {
      // The URL left the drawer entirely — Back past it, or a sidebar link. Close to match.
      if (useSettingsDrawerStore.getState().isOpen) close()
      backgroundRef.current = null
      return
    }

    const carried = (location.state as { backgroundLocation?: Location } | null)?.backgroundLocation
    if (carried) backgroundRef.current = carried

    // Read fresh: this effect writes to the store, so a value captured at render time would already
    // be a commit behind by the second statement.
    const state = useSettingsDrawerStore.getState()
    const top = state.layerStack[state.layerStack.length - 1]
    const topForm = top?.type === 'root' ? undefined : top

    if (urlState.layer) {
      if (!state.isOpen || state.activeTab !== urlState.tab) open(urlState.tab)
      if (!isSameLayer(topForm, urlState.layer)) pushLayer(urlState.layer)
      return
    }

    // A bare tab URL with a form still open — Back out of `/settings/roles/:id` to `/settings/roles`.
    if (topForm) {
      resetToRoot(urlState.tab)
      return
    }

    if (!state.isOpen || state.activeTab !== urlState.tab) {
      open(urlState.tab)
    }
    // Keyed on the history entry, not on the objects React Router recreates each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key, location.pathname])

  // ── drawer → URL ──────────────────────────────────────────────────────────
  // Opening, switching tab, opening/closing a form layer, closing the drawer.
  useEffect(() => {
    const currentPath = window.location.pathname
    const onSettingsUrl = settingsStateFor(currentPath) !== null

    if (isOpen) {
      wasOpenRef.current = true

      // First open over a normal page: that page is what Close returns to.
      if (!onSettingsUrl && !backgroundRef.current) {
        backgroundRef.current = locationRef.current
      }

      const target = settingsPathFor(activeTab, layerStack)
      if (target === currentPath) return

      navigateRef.current(target, {
        // Tab switches replace; opening a form pushes, so Back closes the form and not the drawer.
        replace: onSettingsUrl && layerStack.length <= 1,
        state: backgroundRef.current ? { backgroundLocation: backgroundRef.current } : undefined,
      })
      return
    }

    // Closed while the URL still points at the drawer — hand it back to the page underneath. Only
    // after the drawer has really been open (see wasOpenRef): a cold settings URL arrives here with
    // the drawer not yet opened, and must be left alone for the URL→drawer effect to act on.
    if (wasOpenRef.current && onSettingsUrl) {
      const back = backgroundRef.current
      navigateRef.current(back ? back.pathname + back.search : '/', { replace: true })
    }
    wasOpenRef.current = false
    backgroundRef.current = null
  }, [isOpen, activeTab, layerStack])

  return null
}
