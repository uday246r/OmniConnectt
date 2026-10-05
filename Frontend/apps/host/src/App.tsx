import { lazy, Suspense, useCallback, useEffect, useMemo } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate, type Location } from 'react-router-dom'
import { AppShell } from './layout/AppShell/AppShell'
import { RequireAuth } from './features/auth/components/RequireAuth'
import { RequireCapability } from './features/auth/components/RequireCapability'
import { RequirePasswordChange } from './features/auth/components/RequirePasswordChange'
import { useSilentRefresh } from './features/auth/hooks/useSilentRefresh'
import { usePlatformConnection } from './shared/realtime/usePlatformConnection'
import { usePageViewTracking } from './shared/hooks/usePageViewTracking'
import { useAuthStore } from './features/auth/store/authStore'
import { useRemoteHealthStore } from './shared/stores/remoteHealthStore'
import { useNavigationStore } from './shared/stores/navigationStore'
import { isDrawerRoute, useSettingsDrawerStore } from './shared/stores/settingsDrawerStore'
import { SettingsDrawerUrlSync, useSettingsBackgroundLocation } from './layout/SettingsDrawer/SettingsDrawerUrlSync'
import { RouteFallback } from './shared/components/RouteFallback/RouteFallback'
import { LoginPage } from './pages/LoginPage/LoginPage'
import { PageSkeleton } from './shared/components/PageSkeleton/PageSkeleton'
import { UserDetailSkeleton } from './features/settings-users/components/UserDetailSkeleton/UserDetailSkeleton'
import { isSuperAdminOrAdmin } from './features/auth/store/authStore'
import { lazyWithPreload, preloadWhenIdle } from './shared/utils/lazyWithPreload'

/**
 * Every route is code-split.
 *
 * Previously all thirteen pages were imported statically here, which produced a single ~117KB app
 * chunk plus one ~59KB stylesheet, and index.html preloaded all of it. A user sitting on the login
 * screen was downloading and parsing the audit-logs page, the permission matrix, and all three
 * settings CRUD flows before they had typed a password.
 *
 * AppShell and the route guards stay eager: they are the frame around every authenticated
 * route, so splitting them would only add a waterfall.
 */
// Preloadable: nearly every sign-in lands here, so the chunk is fetched during idle time on the login
// screen and again the instant the form is submitted, removing the Suspense gap after authentication.
const { Component: DashboardPage, preload: preloadDashboard } = lazyWithPreload(() =>
  import('./pages/DashboardPage/DashboardPage').then((m) => ({ default: m.DashboardPage })),
)
// NOT lazy, deliberately. Login is the first — and for an unauthenticated visitor the only — screen
// rendered, so code-splitting it bought nothing: it just inserted a Suspense gap that had to be
// papered over with a skeleton on the very first paint. Importing it eagerly removes that skeleton
// entirely and gets the real form on screen sooner. Everything behind authentication stays split.
const MaintenancePage = lazy(() => import('./pages/MaintenancePage/MaintenancePage').then((m) => ({ default: m.MaintenancePage })))
const NotFoundPage = lazy(() => import('./pages/NotFoundPage/NotFoundPage').then((m) => ({ default: m.NotFoundPage })))
const RemoteAppPage = lazy(() => import('./pages/RemoteAppPage/RemoteAppPage').then((m) => ({ default: m.RemoteAppPage })))
const ProfilePage = lazy(() => import('./features/profile/pages/ProfilePage').then((m) => ({ default: m.ProfilePage })))
const AuditLogsPage = lazy(() =>
  import('./features/system-audit-logs/pages/AuditLogsPage').then((m) => ({ default: m.AuditLogsPage })),
)
const UsersPage = lazy(() =>
  import('./features/settings-users/pages/UsersPage').then((m) => ({ default: m.UsersPage })),
)
const UserDetailPage = lazy(() =>
  import('./features/settings-users/pages/UserDetailPage').then((m) => ({ default: m.UserDetailPage })),
)
const ApprovalCenterPage = lazy(() =>
  import('./features/approvals/pages/ApprovalCenterPage').then((m) => ({ default: m.ApprovalCenterPage })),
)
const SetPasswordPage = lazy(() =>
  import('./pages/SetPasswordPage/SetPasswordPage').then((m) => ({ default: m.SetPasswordPage })),
)
const ForgotPasswordPage = lazy(() =>
  import('./pages/ForgotPasswordPage/ForgotPasswordPage').then((m) => ({ default: m.ForgotPasswordPage })),
)
const ResetPasswordPage = lazy(() =>
  import('./pages/ResetPasswordPage/ResetPasswordPage').then((m) => ({ default: m.ResetPasswordPage })),
)
const MyRequestsPage = lazy(() =>
  import('./features/approvals/pages/MyRequestsPage').then((m) => ({ default: m.MyRequestsPage })),
)
const ManageFieldsPage = lazy(() =>
  import('./features/settings-user-fields/pages/ManageFieldsPage').then((m) => ({ default: m.ManageFieldsPage })),
)
const ManageFormatsPage = lazy(() =>
  import('./features/settings-user-fields/pages/ManageFormatsPage').then((m) => ({ default: m.ManageFormatsPage })),
)
const ManagePasswordPolicyPage = lazy(() =>
  import('./features/settings-password-policy/pages/ManagePasswordPolicyPage').then((m) => ({ default: m.ManagePasswordPolicyPage })),
)
const RolesPage = lazy(() =>
  import('./features/settings-roles/pages/RolesPage').then((m) => ({ default: m.RolesPage })),
)
const ApplicationsPage = lazy(() =>
  import('./features/settings-applications/pages/ApplicationsPage').then((m) => ({ default: m.ApplicationsPage })),
)
const CheckerAssignmentPage = lazy(() =>
  import('./features/approvals/pages/CheckerAssignmentPage').then((m) => ({ default: m.CheckerAssignmentPage })),
)

const SystemLogsPage = lazy(() => import('./features/system-logs/pages/SystemLogsPage').then((m) => ({ default: m.SystemLogsPage })))

const FEATURE_KEYS = {
  dashboard: 'host.dashboard',
  users: 'host.settings.users',
  roles: 'host.settings.roles',
  applications: 'host.settings.applications',
  auditLogs: 'host.system.audit-logs',
  systemLogs: 'host.system.system-logs',
  approvals: 'host.system.approvals',
  checkerAssignment: 'host.system.checker-assignment',
  // Reuses the Users feature key — managing which fields the Create/Edit User form collects is part
  // of the same Users capability, not a separate permission (see UserSchemaController's own gating).
  fields: 'host.settings.users',
  formats: 'host.settings.users',
  // Its own feature: password policy is a security control and is granted separately from user administration.
  passwordPolicy: 'host.settings.password-policy',
} as const

/**
 * The dashboard, gated by the same capability that decides whether its sidebar row appears.
 *
 * The row was hidden for a user without `host.dashboard:View`, but the route itself was open, so
 * typing "/" — or simply signing in, which lands there — rendered the page anyway. Nothing leaked,
 * because every call it makes is permission-checked server-side and the cards just read zero, but a
 * page of zeroes is its own kind of wrong answer: it reads as "the platform is empty" rather than
 * "this isn't yours to see".
 *
 * Denial redirects rather than showing Forbidden. Since "/" is where sign-in lands, a bare denial
 * would make the first screen after logging in an error page, for a user whose account is working
 * exactly as configured. The navigation tree already knows what they CAN reach, so the first row in
 * it is a far better destination — and it is the server's answer, not a guess made here.
 */
function DashboardRoute() {
  const isAdministrator = useAuthStore((s) => isSuperAdminOrAdmin(s.user))
  const hasCapability = useAuthStore((s) => s.hasCapability)
  const navStatus = useNavigationStore((s) => s.status)
  const sections = useNavigationStore((s) => s.sections)

  if (isAdministrator || hasCapability(FEATURE_KEYS.dashboard, 'View')) {
    return <DashboardPage />
  }

  // Redirecting off a tree that has not arrived yet would bounce the user somewhere arbitrary.
  if (navStatus === 'idle' || navStatus === 'loading') {
    return <RouteFallback />
  }

  const firstReachable = sections.flatMap((s) => s.items).find((i) => i.routePath !== '/')
  return firstReachable
    ? <Navigate to={firstReachable.routePath} replace />
    : <NotFoundPage />
}

function LoginRoute() {
  const status = useAuthStore((s) => s.status)
  const login = useAuthStore((s) => s.login)
  const loginWithGoogle = useAuthStore((s) => s.loginWithGoogle)
  const loginLoading = useAuthStore((s) => s.loginLoading)
  const loginError = useAuthStore((s) => s.loginError)
  const location = useLocation()

  // The dashboard is where nearly every sign-in lands, so its chunk is fetched while the user is still
  // typing rather than after they authenticate. The submit handlers below start it again on intent.
  useEffect(() => {
    preloadWhenIdle(preloadDashboard)
  }, [])

  /*
   * Redirect DECLARATIVELY, not from an effect.
   *
   * Redirecting inside useEffect meant that on a successful sign-in React committed one more render of
   * the LOGIN page before the effect ran and changed the route. The error banner from a previous failed
   * attempt lives in that same subtree, so it was painted again — and then the lazy DashboardPage chunk
   * had to download before anything replaced it. That download is what made the stale screen linger
   * long enough to read as "it showed the error, then after some time the success page".
   *
   * Returning <Navigate> means the moment status flips to authenticated this component renders a
   * redirect and nothing else: the login UI cannot repaint.
   */
  if (status === 'authenticated') {
    const from = (location.state as { from?: Pick<Location, 'pathname'> } | null)?.from?.pathname ?? '/'
    return <Navigate to={from} replace />
  }

  return (
    // No Suspense wrapper and no skeleton: LoginPage is imported eagerly (see its import above), so
    // it is already in the initial bundle and paints immediately.
    <LoginPage
      onSubmit={login}
      onGoogleCredential={loginWithGoogle}
      loading={loginLoading}
      errorMessage={loginError}
    />
  )
}

/*
 * Previously this redirected administrators away, on the reasoning that Super Admins never create
 * approval requests. Only SUPER administrators bypass approval (UsersController passes
 * `bypassApproval: IsSuperAdmin()`); every other administrator is an ordinary maker. The redirect
 * therefore made the page — and with it the only "Get password" button in the app — unreachable for
 * exactly the people who had just created an account and needed the credential.
 *
 * The route now renders for everyone; an administrator who has genuinely never made a request sees
 * the normal empty state.
 */

function AuthenticatedShell() {
  // Narrow selectors: a token refresh writes a new `user` object and token every ~14 minutes, and
  // subscribing to those whole values re-rendered the entire shell each time for nothing visible.
  const userName = useAuthStore((s) => s.user?.name)
  const hasSession = useAuthStore((s) => Boolean(s.accessToken))
  const logout = useAuthStore((s) => s.logout)
  const ensureFreshAccessToken = useAuthStore((s) => s.ensureFreshAccessToken)
  const navigate = useNavigate()

  /*
   * Remember where the operator was before the settings drawer took over, so closing it puts them
   * back rather than on the dashboard.
   *
   * Recorded here, at the shell, because the drawer has many entry points — the gear button, sidebar
   * rows, a global-search result, a bookmarked URL — and every one of them should return to the same
   * place. Drawer routes themselves are skipped (see isDrawerRoute) or closing would just return to
   * another drawer; /settings/users and /settings/users/:id are real pages and so remain valid
   * targets.
   */
  const shellLocation = useLocation()
  const setReturnPath = useSettingsDrawerStore((s) => s.setReturnPath)
  useEffect(() => {
    if (isDrawerRoute(shellLocation.pathname)) return
    setReturnPath(`${shellLocation.pathname}${shellLocation.search}`)
  }, [shellLocation.pathname, shellLocation.search, setReturnPath])

  // Every page opened, host or remote, goes into the audit trail — resolved and labelled server-side.
  usePageViewTracking()

  // The sidebar is rendered entirely from this tree, and it is the only source of it. A second feed
  // listing the same apps used to sit alongside this one; the two answered the same question with
  // two different permission filters, and could disagree.
  const navStatus = useNavigationStore((s) => s.status)
  const fetchNavigation = useNavigationStore((s) => s.fetch)

  useEffect(() => {
    if (!hasSession || navStatus !== 'idle') return
    void ensureFreshAccessToken()
      .then((token) => fetchNavigation(token))
      .catch(() => {
        // ensureFreshAccessToken already routes to /login via authStore on failure
      })
  }, [hasSession, navStatus, ensureFreshAccessToken, fetchNavigation])

  // The sidebar badge needs only each app's key and health. Subscribing to the entries array
  // re-rendered the shell on every poll, because each poll stores a new array even when nothing
  // changed (a probe timestamp always moves). A string signature changes only when a badge would.
  const healthSignature = useRemoteHealthStore((s) => s.entries.map((e) => `${e.key}=${e.health}`).join('|'))
  const healthStatus = useRemoteHealthStore((s) => s.status)
  const refetchHealth = useRemoteHealthStore((s) => s.refetch)

  useEffect(() => {
    if (!hasSession || healthStatus !== 'idle') return
    void refetchHealth()
  }, [hasSession, healthStatus, refetchHealth])

  /*
   * The cadence is adaptive, for the same reason the server's own sweep is: while everything is
   * green there is nothing to watch for and a minute is plenty, but while an app is showing as
   * anything other than healthy the poll interval IS how long a wrong answer stays on screen. A flat
   * 60s meant an app that had already come back up kept its warning badge for up to a minute.
   *
   * Health is polled rather than folded into the navigation tree because it is rewritten on a probe
   * interval while the tree is cached — baking one into the other would serve a stale status from a
   * cache with no reason to expire when a probe lands.
   */
  const hasUnsettledApp = useRemoteHealthStore((s) => s.entries.some((e) => e.health !== 'Healthy'))

  useEffect(() => {
    if (!hasSession) return
    const period = hasUnsettledApp ? 10_000 : 60_000
    const interval = setInterval(() => {
      // A tab nobody is looking at does not need live badges; it catches up on the next visible tick.
      if (document.visibilityState === 'hidden') return
      // Force an actual re-probe while something looks wrong: the plain read returns whatever the
      // background sweep last stored, which is exactly the stale value we are trying to move past.
      // When all is well, the cheap stored read is fine.
      void refetchHealth(hasUnsettledApp)
    }, period)
    return () => clearInterval(interval)
  }, [hasSession, refetchHealth, hasUnsettledApp])

  // Settings visibility (the gear and its tabs) is decided from SETTINGS_SECTIONS where it is used.
  // canAccessAuditLogs / canAccessApprovals are gone: the sidebar no longer takes per-section access
  // flags from the client, because the navigation tree already applied those same permissions
  // server-side. Deciding visibility twice, in two languages, is how the two drift apart.

  // Keyed by app for the sidebar's "not responding" badge; rebuilt only when a badge would change.
  const appHealth = useMemo(
    () => Object.fromEntries(useRemoteHealthStore.getState().entries.map((e) => [e.key, e.health])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [healthSignature],
  )

  const handleLogout = useCallback(() => {
    void logout().then(() => navigate('/login', { replace: true }))
  }, [logout, navigate])

  return <AppShell appHealth={appHealth} userName={userName} onLogout={handleLogout} />
}

/**
 * Layout route that wraps all authenticated page outlets in a Suspense boundary.
 *
 * React Router v6 requires every child of <Route> to itself be a <Route> — placing
 * <Suspense> directly inside a <Route>'s children throws "is not a <Route> component".
 * The layout-route pattern is the idiomatic fix: this component renders
 * <Suspense><Outlet /></Suspense>, and page <Route>s are nested inside a
 * <Route element={<AuthenticatedPagesLayout />}> so RR6 sees only valid Route children.
 *
 * The fallback is PageSkeleton, NOT AppShellSkeleton. This boundary sits inside AuthenticatedShell,
 * so the real Sidebar and Topbar are already mounted by the time a page chunk is loading — using the
 * shell skeleton here painted a second, fake sidebar and navbar inside the content area, on top of
 * the real ones. PageSkeleton draws only what the page itself owns: banner, stat cards, toolbar,
 * table.
 */
function AuthenticatedPagesLayout() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Outlet />
    </Suspense>
  )
}

/**
 * Session-wide background work, in a component of its own.
 *
 * These hooks used to run in AppRoutes, so the token-expiry subscription inside useSilentRefresh
 * re-rendered AppRoutes — and with it the whole route tree, the active page and any mounted remote app
 * — every time the token was refreshed. Rendering nothing, this component absorbs those updates.
 */
function SessionServices() {
  useSilentRefresh()
  // Opens the SignalR connection once authenticated and tears it down on logout, so the approval
  // tables, the notification badges and the dashboard KPIs update on a server event rather than a
  // timer. Self-disables when VITE_REALTIME_ENABLED is "false".
  usePlatformConnection()
  return null
}

function AppRoutes() {
  const hydrate = useAuthStore((s) => s.hydrate)

  useEffect(() => {
    void hydrate()
    /*
     * Start the Dashboard chunk fetch in parallel with the hydrate() round trip, not after it.
     *
     * On a hard refresh landing directly on an authenticated route, LoginRoute never mounts this
     * session, so its own idle-preload of Dashboard never fires — the chunk was still unfetched by
     * the time hydrate() resolved. Suspense then had to show RouteFallback (a differently-shaped
     * skeleton: two header blocks + five text lines) sandwiched between RequireAuth's AppShellSkeleton
     * and Dashboard's own internal skeleton, a visible "wrong skeleton flashes in the middle" glitch.
     * Firing this eagerly means the chunk is normally already resolved by the time hydrate() finishes,
     * so Suspense never needs the fallback at all in the common case.
     */
    void preloadDashboard()
  }, [hydrate])

  /*
   * While a settings drawer URL is open, the page routes render the location the operator came from.
   * The same page element stays mounted under the drawer instead of being swapped for a copy, so
   * nothing behind it reloads — see SettingsDrawerUrlSync.
   */
  const routesLocation = useSettingsBackgroundLocation()

  return (
    <Suspense fallback={<RouteFallback />}>
      {/* Outside <Routes>, so it sees the real drawer URL rather than the page rendered behind it. */}
      <SessionServices />
      <SettingsDrawerUrlSync />
      <Routes location={routesLocation}>
        <Route path="/login" element={<LoginRoute />} />
        {/*
          Public by necessity — the recipient of an invite has no credentials yet, which is the whole
          point. Sits outside RequireAuth alongside /login for that reason. The token in the query
          string is the only thing that grants access, and the server treats it as single-use.
        */}
        <Route
          path="/set-password"
          element={
            <Suspense fallback={<RouteFallback />}>
              <SetPasswordPage />
            </Suspense>
          }
        />

        {/*
          "Forgot password?" — same public-by-necessity reasoning as /set-password above: whoever is
          here has no working session yet, either because they never signed in or because they cannot
          remember their password.
        */}
        <Route
          path="/forgot-password"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ForgotPasswordPage />
            </Suspense>
          }
        />
        <Route
          path="/reset-password"
          element={
            <Suspense fallback={<RouteFallback />}>
              <ResetPasswordPage />
            </Suspense>
          }
        />

      <Route
        element={
          <RequireAuth>
            <RequirePasswordChange>
              <AuthenticatedShell />
            </RequirePasswordChange>
          </RequireAuth>
        }
      >
        {/*
          AuthenticatedPagesLayout is a layout Route whose sole job is to wrap the
          authenticated page outlet in a Suspense boundary.

          Placing <Suspense> directly as a child of <Route> is invalid in React Router v6 —
          all children of <Route> must themselves be <Route> components, which is why the
          previous attempt threw "is not a <Route> component". The layout-route pattern is
          the correct solution: this Route renders AuthenticatedPagesLayout (which renders
          <Suspense><Outlet /></Suspense>), and all page routes are nested inside it.

          The fallback is PageSkeleton, which draws only the page's own content (banner, stat
          cards, toolbar, table). It must NOT be AppShellSkeleton: this boundary renders inside
          AuthenticatedShell, so the real Sidebar and Topbar are already on screen and the shell
          skeleton painted a duplicate fake sidebar and navbar inside the content area.
        */}
        <Route element={<AuthenticatedPagesLayout />}>
          <Route index element={<DashboardRoute />} />
          <Route path="profile" element={<ProfilePage />} />
          {/*
            Two routes, one component. /apps/lead resolves to the first page the caller can see;
            /apps/lead/view-lead is a real address that survives a refresh and can be linked or
            bookmarked. Neither hardcodes a page name — the segments come from the navigation tree.
          */}
          <Route path="apps/:appKey" element={<RemoteAppPage />} />
          <Route path="apps/:appKey/:page" element={<RemoteAppPage />} />

          <Route
            path="system/audit-logs"
            element={
              <RequireCapability featureKey={FEATURE_KEYS.auditLogs}>
                <AuditLogsPage />
              </RequireCapability>
            }
          />

          <Route
            path="system/system-logs"
            element={
              <RequireCapability featureKey={FEATURE_KEYS.systemLogs}>
                <SystemLogsPage />
              </RequireCapability>
            }
          />

          <Route
            path="system/approvals"
            element={
              <RequireCapability featureKey={FEATURE_KEYS.approvals}>
                <ApprovalCenterPage />
              </RequireCapability>
            }
          />
          <Route path="system/checker-assignment" element={<Navigate to="/settings/checker-assignment" replace />} />

          {/* No capability gate — every authenticated user tracks their own submitted requests
              regardless of whether they hold Approval Center access; the backend scopes this to the
              caller's own id server-side (see GET /api/approvals/mine), so there is nothing to leak. */}
          <Route path="my-requests" element={<MyRequestsPage />} />

          {/*
            Settings pages. Roles, applications, checker assignment, and users render as full pages.
            Their create/edit forms open in the slide-over drawer via pushLayer.
          */}
          <Route path="settings">
            <Route index element={<Navigate to="users" replace />} />
            <Route path="users">
              <Route
                index
                element={
                  <RequireCapability featureKey={FEATURE_KEYS.users}>
                    <UsersPage />
                  </RequireCapability>
                }
              />
              <Route
                path=":id"
                element={
                  <RequireCapability featureKey={FEATURE_KEYS.users}>
                    <Suspense fallback={<UserDetailSkeleton />}>
                      <UserDetailPage />
                    </Suspense>
                  </RequireCapability>
                }
              />
            </Route>

            <Route
              path="roles"
              element={
                <RequireCapability featureKey={FEATURE_KEYS.roles}>
                  <RolesPage />
                </RequireCapability>
              }
            />

            <Route
              path="applications"
              element={
                <RequireCapability featureKey={FEATURE_KEYS.applications}>
                  <ApplicationsPage />
                </RequireCapability>
              }
            />

            <Route
              path="checker-assignment"
              element={
                <RequireCapability featureKey={FEATURE_KEYS.checkerAssignment}>
                  <CheckerAssignmentPage />
                </RequireCapability>
              }
            />

            {/* Real pages, not drawer tabs. Both screens edit everything inline (a modal per
                field/format), so no sub-route is needed. */}
            <Route
              path="fields"
              element={
                <RequireCapability featureKey={FEATURE_KEYS.fields}>
                  <ManageFieldsPage />
                </RequireCapability>
              }
            />
            <Route
              path="formats"
              element={
                <RequireCapability featureKey={FEATURE_KEYS.formats}>
                  <ManageFormatsPage />
                </RequireCapability>
              }
            />
            <Route
              path="password-policy"
              element={
                <RequireCapability featureKey={FEATURE_KEYS.passwordPolicy}>
                  <ManagePasswordPolicyPage />
                </RequireCapability>
              }
            />
          </Route>
        </Route>
      </Route>

        <Route path="/maintenance-preview" element={<MaintenancePage appDisplayName="Example App" />} />
        <Route path="/404" element={<NotFoundPage />} />
        <Route path="*" element={<Navigate to="/404" replace />} />
      </Routes>
    </Suspense>
  )
}

function App() {
  return (
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  )
}

export default App
