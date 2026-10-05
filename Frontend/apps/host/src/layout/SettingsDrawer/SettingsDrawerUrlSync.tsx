import { useEffect, useMemo, useRef } from 'react'
import { useLocation, useNavigate, type Location } from 'react-router-dom'
import { useAuthStore, isSuperAdminOrAdmin } from '../../features/auth/store/authStore'
import { isDrawerRoute, useSettingsDrawerStore } from '../../shared/stores/settingsDrawerStore'
import { defaultSettingsSection, findSettingsSection } from '../../shared/settings/settingsSections'

/**
 * The location the page routes should render: the real one, or — while a settings drawer URL is open —
 * the page the operator came from, so that page stays mounted under the drawer.
 */
export function useSettingsBackgroundLocation(): Location {
  const location = useLocation()
  // Read only while a drawer URL is open. The shell records returnPath after every navigation, and
  // subscribing to it unconditionally re-rendered the whole route tree — the page and any mounted
  // remote app — a second time for each page change.
  const onDrawerRoute = isDrawerRoute(location.pathname)
  const returnPath = useSettingsDrawerStore((s) => (onDrawerRoute ? s.returnPath : null))
  return useMemo<Location>(() => {
    if (!isDrawerRoute(location.pathname)) return location
    const [pathname, search = ''] = (returnPath && !isDrawerRoute(returnPath) ? returnPath : '/').split('?')
    return { pathname, search: search ? `?${search}` : '', hash: '', state: null, key: 'settings-background' }
  }, [location, returnPath])
}

/**
 * Keeps the settings drawer in step with the URL, in both directions.
 */
export function SettingsDrawerUrlSync() {
  const location = useLocation()
  const navigate = useNavigate()
  const status = useAuthStore((s) => s.status)
  const isAdministrator = useAuthStore((s) => isSuperAdminOrAdmin(s.user))
  const hasCapability = useAuthStore((s) => s.hasCapability)
  const openTab = useSettingsDrawerStore((s) => s.open)
  const pushLayer = useSettingsDrawerStore((s) => s.pushLayer)
  const closeDrawer = useSettingsDrawerStore((s) => s.close)
  const previousPath = useRef(location.pathname)

  // Leaving: close the drawer when the real URL moves off a settings screen.
  useEffect(() => {
    const routeChanged = previousPath.current !== location.pathname
    previousPath.current = location.pathname
    if (!routeChanged || isDrawerRoute(location.pathname)) return
    if (useSettingsDrawerStore.getState().isOpen) closeDrawer()
  }, [location.pathname, closeDrawer])

  // Entering: open the section (and form) the URL names.
  useEffect(() => {
    if (status !== 'authenticated' || !isDrawerRoute(location.pathname)) return
    const can = (featureKey: string, capability = 'View') => isAdministrator || hasCapability(featureKey, capability)
    const [, , tab, sub] = location.pathname.replace(/\/+$/, '').split('/')

    if (!tab) {
      const first = defaultSettingsSection(can)
      navigate(first ? `/settings/${first.tab}` : '/404', { replace: true })
      return
    }

    const section = findSettingsSection(tab)
    if (!section) return

    const needed = sub === 'new' ? section.createCapability : sub ? 'Edit' : 'View'
    if (!can(section.featureKey, needed)) {
      navigate('/404', { replace: true })
      return
    }

    // open() resets the layer stack, so a form layer is pushed after it.
    openTab(section.tab)
    if (sub && section.formLayer) {
      if (tab === 'checker-assignment') {
        const params = new URLSearchParams(location.search)
        const appId = params.get('appId') || undefined
        pushLayer({ type: 'checker-assignment-form', module: sub === 'new' ? undefined : sub, appId })
      } else {
        pushLayer(section.formLayer(sub === 'new' ? undefined : sub))
      }
    }
  }, [location.pathname, location.search, status, isAdministrator, hasCapability, openTab, pushLayer, navigate])

  return null
}
