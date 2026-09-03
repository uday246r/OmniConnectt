import { lazy, Suspense, useEffect } from 'react'
import { BrowserRouter, Navigate, Outlet, Route, Routes, useLocation, useNavigate, useParams, type Location } from 'react-router-dom'
import { AppShell } from './layout/AppShell/AppShell'
import { RequireAuth } from './features/auth/components/RequireAuth'
import { RequireCapability } from './features/auth/components/RequireCapability'
import { RequirePasswordChange } from './features/auth/components/RequirePasswordChange'
import { useSilentRefresh } from './features/auth/hooks/useSilentRefresh'
import { useAuthStore } from './features/auth/store/authStore'
import { useModuleRegistryStore } from './shared/stores/moduleRegistryStore'
import { useSettingsDrawerStore, type SettingsTab } from './shared/stores/settingsDrawerStore'
import { RouteFallback } from './shared/components/RouteFallback/RouteFallback'
import { LoginPage } from './pages/LoginPage/LoginPage'
import { PageSkeleton } from './shared/components/PageSkeleton/PageSkeleton'
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
const ApprovalCenterPage = lazy(() =>
  import('./features/approvals/pages/ApprovalCenterPage').then((m) => ({ default: m.ApprovalCenterPage })),
)
const SetPasswordPage = lazy(() =>
  import('./pages/SetPasswordPage/SetPasswordPage').then((m) => ({ default: m.SetPasswordPage })),
)
const MyRequestsPage = lazy(() =>
  import('./features/approvals/pages/MyRequestsPage').then((m) => ({ default: m.MyRequestsPage })),
)

const FEATURE_KEYS = {
  users: 'host.settings.users',
  roles: 'host.settings.roles',
  applications: 'host.settings.applications',
  auditLogs: 'host.system.audit-logs',
  approvals: 'host.system.approvals',
  checkerAssignment: 'host.system.checker-assignment',
} as const

/**
 * Opens the settings drawer for a `/settings/...` URL — and, unlike before, leaves the URL alone.
 *
 * This previously called `navigate('/', { replace: true })` in the same effect that opened the
 * drawer, so every settings URL was thrown away the instant it was consumed. Clicking Users, Roles,
 * Applications or Checker Assignment left the address bar on the dashboard, nothing was linkable, and
 * Back did not step between tabs. The URL is now the source of truth: the tab buttons navigate, and
 * this component reacts.
 *
 * Users, Roles and Applications used to exist twice over: once as routed full pages behind SetupPanel,
 * and once as tabs inside the gear drawer. Both were live, so the same CRUD was maintained in two
 * places and they had drifted badly — the routed forms never received the validation or the
 * catalog-driven permission grid, which is why every bug reported against those screens reproduced
 * there and not in the drawer.
 *
 * The URLs are kept rather than deleted so bookmarks keep working AND so global search keeps working:
 * SearchAppService builds routes like "/settings/users/{id}" server-side, and this is what turns one
 * into an open drawer. `replace` is used so the redirect leaves no dead history entry for Back to
 * bounce off.
 */
function SettingsRoute({ tab }: { tab: SettingsTab }) {
  const { id } = useParams<{ id: string }>()
  const openTab = useSettingsDrawerStore((s) => s.open)
  const pushLayer = useSettingsDrawerStore((s) => s.pushLayer)
  const location = useLocation()

  useEffect(() => {
    openTab(tab)

    // A trailing /new or /:id opens the matching form layer straight away. Ordering matters: open()
    // resets the layer stack, so the push has to follow it, which is why both live in one effect.
    const isNew = location.pathname.endsWith('/new')
    if (isNew || id) {
      const entityId = isNew ? undefined : id
      if (tab === 'users') pushLayer({ type: 'user-form', userId: entityId })
      else if (tab === 'roles') pushLayer({ type: 'role-form', roleId: entityId })
      else if (tab === 'applications') pushLayer({ type: 'app-form', appId: entityId })
    }
  }, [tab, id, location.pathname, openTab, pushLayer])

  /*
   * The dashboard is the backdrop, because the drawer is an overlay and something has to be behind
   * it. This is also exactly what was on screen before: the old version redirected to "/" after
   * opening the drawer, so the dashboard was already what you saw through it — only now the address
   * bar keeps saying where you actually are.
   */
  return <DashboardPage />
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
  const user = useAuthStore((s) => s.user)
  const accessToken = useAuthStore((s) => s.accessToken)
  const hasCapability = useAuthStore((s) => s.hasCapability)
  const logout = useAuthStore((s) => s.logout)
  const ensureFreshAccessToken = useAuthStore((s) => s.ensureFreshAccessToken)
  const navigate = useNavigate()

  const registryStatus = useModuleRegistryStore((s) => s.status)
  const registryApps = useModuleRegistryStore((s) => s.apps)
  const registryError = useModuleRegistryStore((s) => s.error)
  const fetchForSidebar = useModuleRegistryStore((s) => s.fetchForSidebar)

  useEffect(() => {
    if (!accessToken) return
    /*
     * Fetch ONCE per session, on 'idle' only.
     *
     * Retrying on 'error' here was a retry storm, not resilience. The store sets 'error' with an empty
     * app list when the registry is unreachable; `registryStatus` is an effect dependency, so the
     * effect re-ran, saw `error && apps.length === 0`, and fetched again — which set 'loading', which
     * re-ran the effect, forever. Against a downed ModuleRegistry that is an unbounded request loop
     * (netstat showed three simultaneous connection attempts), and because the sidebar renders
     * skeletons whenever status is 'loading', the APPS section sat on grey placeholders through every
     * cycle instead of showing the error state that was already written for it.
     *
     * Hammering a service that is down is also precisely what stops it coming back up. One attempt,
     * then the error state, whose copy already tells the user to refresh.
     */
    if (registryStatus === 'idle') {
      void ensureFreshAccessToken()
        .then(fetchForSidebar)
        .catch(() => {
          // ensureFreshAccessToken already routes to /login via authStore on failure
        })
    }
  }, [accessToken, registryStatus, ensureFreshAccessToken, fetchForSidebar])

  const refetchHealth = useModuleRegistryStore((s) => s.refetchHealth)

  /*
   * Periodic self-correction for the one-shot fetch above.
   *
   * The fetch above deliberately only runs once per session — see its comment. That means a remote
   * app that happened to be down at that single moment (e.g. still starting up) stayed badged
   * "Unreachable" for the rest of the session with no way to self-correct short of a full reload.
   * This polls the lightweight health-only endpoint instead of re-running the fetch above, so it
   * only ever merges `health`/`lastHealthCheckAt` into the existing apps array and never touches
   * `status` — it can't trigger the 'loading' skeleton this file (line ~182) and RemoteAppPage both
   * render whenever status is 'idle' or 'loading'.
   */
  /*
   * The cadence is adaptive, for the same reason the registry's own sweep is: while everything is
   * green there is nothing to watch for and a minute is plenty, but while an app is showing as
   * anything other than healthy the poll interval IS how long a wrong answer stays on screen. A flat
   * 60s meant an app that had already come back up kept its warning badge for up to a minute.
   */
  const hasUnsettledApp = useModuleRegistryStore((s) =>
    s.apps.some((a) => a.health !== undefined && a.health !== 'Healthy'),
  )

  useEffect(() => {
    if (!accessToken) return
    const period = hasUnsettledApp ? 10_000 : 60_000
    const interval = setInterval(() => {
      // Force an actual re-probe while something looks wrong: the plain read returns whatever the
      // registry's background sweep last stored, which is exactly the stale value we are trying to
      // move past. When all is well, the cheap cached read is fine.
      void refetchHealth(hasUnsettledApp)
    }, period)
    return () => clearInterval(interval)
  }, [accessToken, refetchHealth, hasUnsettledApp])

  const isAdministrator = Boolean(user?.isAdministrator)
  const settingsAccess = {
    users: isAdministrator || hasCapability(FEATURE_KEYS.users, 'View'),
    roles: isAdministrator || hasCapability(FEATURE_KEYS.roles, 'View'),
    applications: isAdministrator || hasCapability(FEATURE_KEYS.applications, 'View'),
  }
  const canAccessAuditLogs = isAdministrator || hasCapability(FEATURE_KEYS.auditLogs, 'View')
  const canAccessApprovals = isAdministrator || hasCapability(FEATURE_KEYS.approvals, 'View')

  return (
    <AppShell
      apps={registryStatus === 'idle' || registryStatus === 'loading' ? undefined : registryApps}
      appsError={registryError}
      userName={user?.name}
      settingsAccess={settingsAccess}
      canAccessAuditLogs={canAccessAuditLogs}
      canAccessApprovals={canAccessApprovals}
      onLogout={() => {
        void logout().then(() => navigate('/login', { replace: true }))
      }}
    />
  )
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

function AppRoutes() {
  const hydrate = useAuthStore((s) => s.hydrate)
  useSilentRefresh()

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

  return (
    <Suspense fallback={<RouteFallback />}>
      <Routes>
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
          <Route index element={<DashboardPage />} />
          <Route path="profile" element={<ProfilePage />} />
          <Route path="apps/:appKey" element={<RemoteAppPage />} />

          <Route
            path="system/audit-logs"
            element={
              <RequireCapability featureKey={FEATURE_KEYS.auditLogs}>
                <AuditLogsPage />
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

          {/* No capability gate — every authenticated user tracks their own submitted requests
              regardless of whether they hold Approval Center access; the backend scopes this to the
              caller's own id server-side (see GET /api/approvals/mine), so there is nothing to leak. */}
          <Route path="my-requests" element={<MyRequestsPage />} />

          {/*
            Settings has no pages of its own — it IS the gear drawer, rendered globally by AppShell.

            These routes exist so every /settings/* URL still resolves: each opens the drawer on the right
            tab and, for /new or /:id, pushes the matching form layer, then hands the URL back to the
            dashboard. That keeps bookmarks, the back button and — importantly — global search working,
            since SearchAppService builds "/settings/users/{id}" style routes server-side.

            The routed page components and SetupPanel are gone. They were a second, older implementation
            of the same CRUD, and every bug reported against these screens came from them rather than the
            drawer: the user form there had no validation at all (so it accepted "989898989sssss" and
            "ashok246@gmail.comsssssssss"), and the role form's permission grid still read capabilities off
            the PARENT feature — which for remote.employee declares none, so every column rendered a dash.
            Deleting them is what fixes those, not patching them twice.
          */}
          <Route path="settings">
            <Route index element={<SettingsRoute tab="users" />} />
            {(
              [
                ['users', FEATURE_KEYS.users, 'Create'],
                ['roles', FEATURE_KEYS.roles, 'Create'],
                ['applications', FEATURE_KEYS.applications, 'Register'],
                ['checker-assignment', FEATURE_KEYS.checkerAssignment, 'Manage'],
              ] as const
            ).map(([tab, featureKey, createCapability]) => (
              <Route key={tab} path={tab}>
                <Route
                  index
                  element={
                    <RequireCapability featureKey={featureKey}>
                      <SettingsRoute tab={tab} />
                    </RequireCapability>
                  }
                />
                <Route
                  path="new"
                  element={
                    <RequireCapability featureKey={featureKey} capability={createCapability}>
                      <SettingsRoute tab={tab} />
                    </RequireCapability>
                  }
                />
                <Route
                  path=":id"
                  element={
                    <RequireCapability featureKey={featureKey} capability="Edit">
                      <SettingsRoute tab={tab} />
                    </RequireCapability>
                  }
                />
              </Route>
            ))}
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
