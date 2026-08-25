import { env } from '../../config/env'
import { apiFetch } from './httpClient'

const base = env.moduleRegistryUrl

/**
 * Reachability of a remote app, as last observed by ModuleRegistry's background probe.
 * 'Unknown' means "not probed yet" and is rendered neutrally — never as a failure.
 */
export type RemoteAppHealth = 'Unknown' | 'Healthy' | 'Unreachable'

export interface SidebarAppDto {
  key: string
  displayName: string
  iconKey: string | null
  manifestUrl: string
  sidebarOrder: number
  status: 'Active' | 'Maintenance' | 'Disabled'
  maintenanceMessage: string | null
  health: RemoteAppHealth
  lastHealthCheckAt: string | null
}

export interface HealthEntryDto {
  key: string
  displayName: string
  health: RemoteAppHealth
  lastCheckedAt: string | null
  error: string | null
}

/**
 * Upper bound on how long the sidebar waits for ModuleRegistry.
 *
 * A refused connection already fails on its own (measured ~2.3s to a dead local port), so this is not
 * what fixes the "stuck on skeletons" symptom — that was an unbounded retry loop in App.tsx, fixed
 * there. This covers the case a refused connection does not: a registry that ACCEPTS the socket and
 * then stalls (saturated thread pool, wedged DB call), where fetch waits indefinitely by default.
 *
 * 8s is comfortably above a cold start on a loaded machine and well below the point where a user
 * concludes the app is broken.
 */
const REGISTRY_TIMEOUT_MS = 8000

/** Raw calls against ModuleRegistry's public surface. Admin CRUD calls (Setup > Applications) live in features/settings-applications/api. */
export const moduleRegistryClient = {
  // `signal` needs no change to httpClient: ApiFetchOptions extends RequestInit and spreads ...rest
  // straight into fetch, so an AbortSignal already flows through. An abort surfaces as a rejection,
  // which is exactly what the store's existing catch expects.
  forSidebar: (accessToken: string) =>
    apiFetch<SidebarAppDto[]>(`${base}/api/remote-apps/for-sidebar`, {
      accessToken,
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    }),
  health: (accessToken: string) =>
    apiFetch<HealthEntryDto[]>(`${base}/api/remote-apps/health`, {
      accessToken,
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    }),
  /**
   * Asks the registry to probe the remotes NOW, rather than returning the value its background sweep
   * last stored. Used when the user has just arrived on a page and would reasonably expect what they
   * are looking at to be current — `health` above can be up to a sweep interval old, which is why a
   * recovered app used to keep showing as down no matter how often the page was refreshed.
   *
   * Server-side throttled, so calling it on every mount is safe.
   */
  refreshHealth: (accessToken: string) =>
    apiFetch<HealthEntryDto[]>(`${base}/api/remote-apps/health/refresh`, {
      method: 'POST',
      accessToken,
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT_MS),
    }),
}
