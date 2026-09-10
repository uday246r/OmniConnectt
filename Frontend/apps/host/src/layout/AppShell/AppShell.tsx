import { Suspense, useEffect, useState, useCallback, useRef } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { Sidebar } from '../Sidebar/Sidebar'
import { Topbar, type TopbarSettingsAccess } from '../Topbar/Topbar'
import { isDrawerRoute, useSettingsDrawerStore } from '../../shared/stores/settingsDrawerStore'
import { lazyWithPreload, preloadWhenIdle } from '../../shared/utils/lazyWithPreload'
import styles from './AppShell.module.css'

/**
 * The settings drawer is by far the largest thing in the app — the drawer plus three tabs and three
 * form layers, and the form layers pull in the whole permission-catalog editor. Imported statically it
 * shipped in the eager entry chunk that EVERY user downloads before the login form is interactive,
 * despite rendering nothing at all until someone clicks the gear.
 *
 * Splitting defers that cost; the idle preload then fetches it once the shell has mounted, so by the
 * time an admin reaches for the gear the chunk is already parsed and it still opens instantly.
 */
const { Component: SettingsDrawer, preload: preloadSettingsDrawer } = lazyWithPreload(() =>
  import('../SettingsDrawer/SettingsDrawer').then((m) => ({ default: m.SettingsDrawer })),
)

import { ToastContainer } from '../../shared/components/Toast'

export interface AppShellProps {
  /**
   * Reachability per app key, overlaid onto the sidebar. Kept out of the navigation tree on purpose:
   * the registry rewrites it on a probe interval, so a cached tree would report it wrongly.
   */
  appHealth?: Record<string, 'Unknown' | 'Healthy' | 'Unreachable'>
  userName?: string
  settingsAccess?: TopbarSettingsAccess
  onLogout?: () => void
}

export function AppShell({ appHealth, userName, settingsAccess, onLogout }: AppShellProps) {
  // Subscribed so the drawer is only mounted when it is actually open — mounting it unconditionally
  // would resolve the lazy component on first render and negate the split.
  const drawerOpen = useSettingsDrawerStore((s) => s.isOpen)

  // Mobile sidebar open state — off by default, toggled by hamburger in Topbar
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const closeSidebar = useCallback(() => setSidebarOpen(false), [])
  const location = useLocation()

  // Close sidebar whenever the route changes (user tapped a nav link)
  useEffect(() => {
    closeSidebar()
  }, [location.pathname, closeSidebar])

  /*
   * The settings drawer follows the URL out of /settings, not just into it.
   *
   * SettingsRoute opens it when a /settings/* URL is entered; this is the other half. It covers every
   * way of leaving — the close button and backdrop (which navigate to "/"), a sidebar link, and the
   * browser Back button — with one rule instead of each exit remembering to close the store itself.
   *
   * An override layer (e.g. UserFormLayer for Add/Edit User) can be opened from a non-drawer page
   * such as /settings/users or /settings/users/:id. When the route hasn't changed, that layer was
   * explicitly requested on this page and must not be dismissed immediately. If the user navigates
   * away to another route, the drawer closes.
   */
  const closeDrawer = useSettingsDrawerStore((s) => s.close)
  const layerStack = useSettingsDrawerStore((s) => s.layerStack)
  const prevPathRef = useRef(location.pathname)

  useEffect(() => {
    const routeChanged = prevPathRef.current !== location.pathname
    prevPathRef.current = location.pathname

    if (!drawerOpen) return

    const isOverrideLayer = layerStack.length > 1
    if (isOverrideLayer && !routeChanged) return

    if (!isDrawerRoute(location.pathname)) {
      closeDrawer()
    }
  }, [location.pathname, drawerOpen, layerStack.length, closeDrawer])

  // Prevent body scroll while mobile sidebar is overlaying the content
  useEffect(() => {
    document.body.style.overflow = sidebarOpen ? 'hidden' : ''
    return () => { document.body.style.overflow = '' }
  }, [sidebarOpen])

  useEffect(() => {
    preloadWhenIdle(preloadSettingsDrawer)
  }, [])

  return (
    <div className={styles.shell}>
      {/* Global Toast Notification System */}
      <ToastContainer />

      {/*
        The sidebar renders itself from the navigation tree — it no longer takes an app list or
        per-section access flags, because the server already decided both. Health is the one thing
        still passed in: it changes on a probe interval, so it is deliberately not part of the cached
        tree and is overlaid here instead.
      */}
      <Sidebar
        health={appHealth}
        mobileOpen={sidebarOpen}
        onMobileClose={closeSidebar}
      />

      {/* Mobile backdrop — dims content behind the open sidebar */}
      {sidebarOpen && (
        <div
          className={styles.sidebarBackdrop}
          onClick={closeSidebar}
          aria-hidden="true"
        />
      )}

      <div className={styles.main}>
        {/* Topbar — single source of truth for user identity & profile actions */}
        <Topbar
          userName={userName}
          settingsAccess={settingsAccess}
          onLogout={onLogout}
          onMobileMenuToggle={() => setSidebarOpen((v) => !v)}
        />
        <div className={styles.content}>
          <Outlet />
        </div>
      </div>

      {/*
        Global slide-over settings & override layers.

        No Suspense fallback: the drawer animates in from the edge, so a spinner in its place would be
        a visible flash of nothing where a panel is about to be. The idle preload means the chunk is
        normally already resolved; if it is not, the drawer simply appears a moment later, which is
        indistinguishable from a slightly slower animation.
      */}
      {drawerOpen && (
        <Suspense fallback={null}>
          <SettingsDrawer />
        </Suspense>
      )}
    </div>
  )
}
