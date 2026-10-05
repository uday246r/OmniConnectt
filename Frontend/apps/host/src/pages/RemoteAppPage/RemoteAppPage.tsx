import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState, type ComponentType, type LazyExoticComponent } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Button } from '@omniconnect/ui'
import { registerSessionCleanup } from '../../features/auth/store/authStore'
import { useNavigationStore } from '../../shared/stores/navigationStore'
import type { NavNodeDto } from '../../shared/api/navigationApi'
import { loadRemoteAppModule, needsReloadForNewVersion } from '../../shared/federation/remoteLoader'
import { FederationErrorBoundary } from '../../shared/components/ErrorBoundary/FederationErrorBoundary'
import { SkeletonBlock } from '../../shared/components/Skeleton'
import { MaintenancePage } from '../MaintenancePage/MaintenancePage'
import { NotFoundPage } from '../NotFoundPage/NotFoundPage'
import styles from './RemoteAppPage.module.css'

/** The props every remote's exported App accepts. The host is the only caller. */
interface RemoteAppProps {
  page?: string
  /**
   * Whatever follows the page in the URL — "123" for /apps/lead/view-lead/123 — so a remote can
   * deep-link to one record and survive a refresh. Empty when the URL stops at the page.
   */
  subPath?: string
  onNavigate?: (page: string) => void
}

// React.lazy() must return the same component reference across renders or it re-suspends forever —
// so one lazy-wrapped loader per remote BUILD, keyed by app and manifest URL. Keyed by app alone, a
// promoted version kept resolving to the previous build's wrapper for the life of the tab.
const lazyComponentCache = new Map<string, LazyExoticComponent<ComponentType<RemoteAppProps>>>()

// Module-level and therefore shared across sign-ins. Evict on logout so the next user does not
// inherit federated components loaded under the previous user's session.
registerSessionCleanup(() => lazyComponentCache.clear())

const cacheKey = (appKey: string, manifestUrl: string) => `${appKey}@${manifestUrl}`

function getLazyComponent(appKey: string, manifestUrl: string, displayName: string) {
  const id = cacheKey(appKey, manifestUrl)
  let cached = lazyComponentCache.get(id)
  if (!cached) {
    cached = lazy(async () => {
      const mod = await loadRemoteAppModule({ key: appKey, manifestUrl, displayName })
      return { default: mod.default as ComponentType<RemoteAppProps> }
    })
    lazyComponentCache.set(id, cached)
  }
  return cached
}

function LoadingFrame() {
  return (
    <div className={styles.wrapper}>
      <SkeletonBlock height={480} radius="var(--omni-radius-lg)" />
    </div>
  )
}

/**
 * Mounts a remote app, but only after the host has decided the caller may reach it.
 *
 * The order matters and is the whole point of this component: every gate runs BEFORE
 * loadRemoteAppModule is called, so an app the caller may not reach is never fetched over the network
 * at all. Previously this checked only the registry's status and mounted for any authenticated user,
 * which meant a remote's bundle was downloadable by typing its URL.
 *
 * The navigation tree is the source of truth for access. A node absent from it is one the server
 * decided this user must not see, so there is nothing to reason about here beyond "is it present,
 * and in what state".
 */
export function RemoteAppPage() {
  const params = useParams<{ appKey: string; page?: string; '*'?: string }>()
  const { appKey, page } = params
  const subPath = params['*'] ?? ''
  const navigate = useNavigate()
  const status = useNavigationStore((s) => s.status)
  const node = useNavigationStore((s) => (appKey ? s.findApp(appKey) : undefined))

  /*
   * One callback for the life of this page. It used to be a new arrow on every render, and
   * `useNavigate()` itself changes whenever the URL does, so the remote app — which receives it as a
   * prop — re-rendered in full on every host render and every navigation. The ref always holds the
   * latest navigate, so the stable callback never goes stale.
   */
  const navigateRef = useRef(navigate)
  useEffect(() => {
    navigateRef.current = navigate
  }, [navigate])
  const remoteAppKey = node?.remote?.appKey
  const onNavigate = useCallback(
    (target: string) => navigateRef.current(`/apps/${remoteAppKey}/${target}`),
    [remoteAppKey],
  )

  if (status === 'idle' || status === 'loading') {
    return <LoadingFrame />
  }

  // Absent from the tree: either no such app, or one this user has no access to. Both answer 404,
  // deliberately — distinguishing them would confirm the existence of apps the caller cannot use.
  if (!node?.remote) {
    return <NotFoundPage />
  }

  // Maintenance, and this caller holds no bypass: the server did not even send where the app lives.
  if (node.state === 'maintenance' || !node.remote.manifestUrl) {
    return <MaintenancePage appDisplayName={node.label} message={node.maintenanceMessage} />
  }

  // /apps/lead with no page lands on the first page the caller can actually see, rather than
  // whichever page the remote happens to default to — which may be one they lack permission for.
  if (!page && node.remote.defaultRoutePath) {
    return <Navigate to={node.remote.defaultRoutePath} replace />
  }

  // A page segment that is not in this app's children is a stale bookmark or a hand-typed guess.
  if (page && !node.children.some((c) => c.page === page)) {
    return <NotFoundPage />
  }

  // Keyed by app: an error screen belongs to the app that failed, and must not stay on screen (or keep
  // its retry count) after the user moves to a different app.
  return (
    <ActiveRemoteApp
      key={node.remote.appKey}
      node={node}
      manifestUrl={node.remote.manifestUrl}
      page={page}
      subPath={subPath}
      onNavigate={onNavigate}
    />
  )
}

/** Shown when a newer build was promoted after this tab had already loaded the app. */
function NewVersionAvailable({ appDisplayName }: { appDisplayName: string }) {
  return (
    <div className={styles.errorCard} role="status">
      <h1>A new version of {appDisplayName} is available</h1>
      <p>Reload the page to start using it. Nothing you have saved is affected.</p>
      <Button onClick={() => window.location.reload()}>Reload now</Button>
    </div>
  )
}

/**
 * Memoized: its props are the navigation node (stable until the tree is reloaded), the page and a
 * stable callback, so the remote re-renders when the user moves between its pages — not whenever the
 * host shell above it re-renders.
 */
const ActiveRemoteApp = memo(function ActiveRemoteApp({
  node,
  manifestUrl,
  page,
  subPath,
  onNavigate,
}: {
  node: NavNodeDto
  manifestUrl: string
  page?: string
  subPath: string
  onNavigate: (page: string) => void
}) {
  const appKey = node.remote!.appKey

  /*
   * The build this mount started with. A release can promote a new one while the user is in the
   * middle of a form here; swapping it underneath them would throw away what they typed, so the
   * mounted remote keeps running the build it started with. The new one is picked up the next time
   * the app is entered — via a reload, because a page cannot run two builds of one remote at once.
   */
  const [pinnedUrl] = useState(manifestUrl)
  const firstMountIsStale = useState(() => needsReloadForNewVersion({ key: appKey, manifestUrl }))[0]

  // Bumped by a retry purely to re-render with a freshly built lazy wrapper.
  const [, setAttempt] = useState(0)

  if (firstMountIsStale) {
    return <NewVersionAvailable appDisplayName={node.label} />
  }

  const LazyRemote = getLazyComponent(appKey, pinnedUrl, node.label)

  return (
    <div className={node.state === 'maintenance-bypass' ? styles.wrapper : undefined}>
      {node.state === 'maintenance-bypass' && (
        <div className={styles.bypassBanner} role="status">
          {node.label} is in maintenance. You can open it because your role allows maintenance access;
          other users see the maintenance notice.
        </div>
      )}
      {/*
        Deliberately NOT keyed by the attempt: a key change remounts the boundary, which reset its
        automatic-retry budget on every attempt, so a remote that was simply down was retried every two
        seconds forever. The boundary owns the budget; a retry only swaps the lazy wrapper below it.
      */}
      <FederationErrorBoundary
        appDisplayName={node.label}
        onRetry={() => {
          lazyComponentCache.delete(cacheKey(appKey, pinnedUrl))
          // The failure may be the build having been rolled back or removed; read the tree again so
          // the next mount uses whatever is live now.
          void useNavigationStore.getState().refresh()
          setAttempt((n) => n + 1)
        }}
      >
        <Suspense fallback={<LoadingFrame />}>
          <LazyRemote page={page} subPath={subPath} onNavigate={onNavigate} />
        </Suspense>
      </FederationErrorBoundary>
    </div>
  )
})
