import { env } from '../../../config/env'
import { apiFetch } from '../../../shared/api/httpClient'
import { remoteAppsApi, type HealthEntryDto } from '../../settings-applications/api/remoteAppsApi'

const base = env.authServiceUrl

/**
 * Period-over-period change. Absent (null) when the previous period had no baseline — growth from
 * zero has no defined percentage, so the card renders without a trend rather than inventing one.
 */
export interface TrendDto {
  percent: number
  caption: string
}

export interface RoleDistributionDto {
  roleName: string
  userCount: number
}

/** Audit-event volume per service in the last 30 days. Real recorded activity, not an estimate. */
export interface ServiceActivityDto {
  serviceName: string
  eventCount: number
}

/**
 * Aggregate counts for the dashboard.
 *
 * A null count means "you don't have permission to see this" — deliberately distinct from 0, which
 * means you can see it and it is genuinely zero. The dashboard omits the card entirely for a null
 * rather than rendering a fabricated zero.
 */
export interface DashboardStatsDto {
  users: number | null
  activeUsers: number | null
  roles: number | null
  auditEvents: number | null
  usersTrend: TrendDto | null
  rolesTrend: TrendDto | null
  auditEventsTrend: TrendDto | null
  roleDistribution: RoleDistributionDto[]
  serviceActivity: ServiceActivityDto[]
}

export type { HealthEntryDto }

export const dashboardApi = {
  /** One round trip. Replaces three list calls that fetched a throwaway row each just to read `total`. */
  stats: (accessToken: string, signal?: AbortSignal) =>
    apiFetch<DashboardStatsDto>(`${base}/api/dashboard/stats`, { accessToken, signal }),

  /** Real reachability per registered remote app, as last recorded by AuthService's background probe. */
  health: (accessToken: string, signal?: AbortSignal) => remoteAppsApi.health(accessToken, signal),

  /**
   * Reachability, re-probed now.
   *
   * The System Status card is the most prominent health readout in the product, so it should not be
   * showing a value that could be a whole sweep interval old — that is precisely how a recovered app
   * ended up still reported as "Degraded" no matter how many times the page was refreshed. The
   * server throttles this, so calling it on every dashboard mount is safe.
   */
  refreshHealth: (accessToken: string, signal?: AbortSignal) =>
    remoteAppsApi.refreshHealth(accessToken, signal),
}
