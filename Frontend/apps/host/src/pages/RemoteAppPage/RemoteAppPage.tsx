import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState, type ComponentType, type LazyExoticComponent } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { registerSessionCleanup } from '../../features/auth/store/authStore'
import { useNavigationStore } from '../../shared/stores/navigationStore'
import type { NavNodeDto } from '../../shared/api/navigationApi'
import { loadRemoteAppModule } from '../../shared/federation/remoteLoader'
import { FederationErrorBoundary } from '../../shared/components/ErrorBoundary/FederationErrorBoundary'
import { SkeletonBlock } from '../../shared/components/Skeleton'
import { MaintenancePage } from '../MaintenancePage/MaintenancePage'
import { NotFoundPage } from '../NotFoundPage/NotFoundPage'
import styles from './RemoteAppPage.module.css'

/** The props every remote's exported App accepts. The host is the only caller. */
interface RemoteAppProps {
  page?: string
  onNavigate?: (page: string) => void
}

// React.lazy() must return the same component reference across renders or it re-suspends forever
// — cache one lazy-wrapped loader per remote app key for the life of the tab.
const lazyComponentCache = new Map<string, LazyExoticComponent<ComponentType<RemoteAppProps>>>()

// Module-level and therefore shared across sign-ins. Evict on logout so the next user does not
// inherit federated components loaded under the previous user's session.
registerSessionCleanup(() => lazyComponentCache.clear())

function getLazyComponent(appKey: string, manifestUrl: string) {
  let cached = lazyComponentCache.get(appKey)
  if (!cached) {
    cached = lazy(async () => {
      const mod = await loadRemoteAppModule({ key: appKey, manifestUrl })
      return { default: mod.default as ComponentType<RemoteAppProps> }
    })
    lazyComponentCache.set(appKey, cached)
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
  const { appKey, page } = useParams<{ appKey: string; page?: string }>()
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


  if (node.state === 'maintenance') {
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
  return <ActiveRemoteApp key={node.remote.appKey} node={node} page={page} onNavigate={onNavigate} />
}

/**
 * Split out so "Try again" can force a real re-render: React.lazy()'s promise is cached forever
 * once it rejects, so retrying has to evict lazyComponentCache's entry AND bump this local key —
 * bumping alone wouldn't help if the cache still held the failed lazy wrapper, and evicting alone
 * wouldn't re-render without something changing.
 */
/**
 * Memoized: its props are the navigation node (stable until the tree is reloaded), the page and a
 * stable callback, so the remote re-renders when the user moves between its pages — not whenever the
 * host shell above it re-renders.
 */
const ActiveRemoteApp = memo(function ActiveRemoteApp({
  node,
  page,
  onNavigate,
}: {
  node: NavNodeDto
  page?: string
  onNavigate: (page: string) => void
}) {
  const [attempt, setAttempt] = useState(0)
  const appKey = node.remote!.appKey
  const LazyRemote = getLazyComponent(appKey, node.remote!.manifestUrl)

  return (
    <FederationErrorBoundary
      key={attempt}
      appDisplayName={node.label}
      onRetry={() => {
        lazyComponentCache.delete(appKey)
        setAttempt((n) => n + 1)
      }}
    >
      <Suspense fallback={<LoadingFrame />}>
        <LazyRemote page={page} onNavigate={onNavigate} />
      </Suspense>
    </FederationErrorBoundary>
  )
})
