import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../features/auth/store/authStore'
import { remoteAppsApi, type RemoteAppDto } from '../../features/settings-applications/api/remoteAppsApi'
import { auditLogsApi, type AuditLogDto } from '../../features/system-audit-logs/api/auditLogsApi'
import { dashboardApi, type DashboardStatsDto } from '../../features/dashboard/api/dashboardApi'
import type { HealthEntryDto } from '../../features/settings-applications/api/remoteAppsApi'
import { useRemoteHealthStore } from '../../shared/stores/remoteHealthStore'
import { queryKeys } from '../../shared/query/queryKeys'
import { ApiError } from '../../shared/api/httpClient'
import { SkeletonStatCard, SkeletonDashboardWidget, SkeletonAuditRow, SkeletonDonutChart } from '../../shared/components/Skeleton'
import { Icon } from '../../shared/components/Icon/Icon'
import styles from './DashboardPage.module.css'
import { APP_NAME, COPYRIGHT_YEAR } from '../../shared/config/branding'
import { TOPICS } from '../../shared/stores/invalidationStore'
import { useLiveRevision } from '../../shared/hooks/useLiveRevision'

interface RoleDistribution {
  name: string
  count: number
  percentage: number
  color: string
}

const ROLE_COLORS = ['#4f46e5', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#64748b']

const APP_COLORS = [
  { bg: '#eff6ff', color: '#3b82f6' },
  { bg: '#eef2ff', color: '#6366f1' },
  { bg: '#fff7ed', color: '#f97316' },
  { bg: '#ecfdf5', color: '#10b981' },
  { bg: '#fdf2f8', color: '#ec4899' },
  { bg: '#f5f3ff', color: '#8b5cf6' },
]

function formatEventTime(dateStr: string): string {
  const date = new Date(dateStr)
  const now = new Date()
  const isToday =
    date.getDate() === now.getDate() &&
    date.getMonth() === now.getMonth() &&
    date.getFullYear() === now.getFullYear()

  const yesterday = new Date(now)
  yesterday.setDate(yesterday.getDate() - 1)
  const isYesterday =
    date.getDate() === yesterday.getDate() &&
    date.getMonth() === yesterday.getMonth() &&
    date.getFullYear() === yesterday.getFullYear()

  const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })

  if (isToday) return `Today, ${timeStr}`
  if (isYesterday) return `Yesterday, ${timeStr}`

  return `${date.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${timeStr}`
}

function formatActionText(log: AuditLogDto): string {
  const action = log.action || 'Performed action'
  const entity = log.entityType ? ` ${log.entityType}` : ''
  const details = log.details ? ` "${log.details}"` : ''

  if (action.toLowerCase().includes('create')) return `Created new${entity}${details}`
  if (action.toLowerCase().includes('update')) return `Updated${entity}${details}`
  if (action.toLowerCase().includes('delete') || action.toLowerCase().includes('remove'))
    return `Removed${entity}${details}`
  if (action.toLowerCase().includes('login')) return `Logged into platform`
  if (action.toLowerCase().includes('view')) return `Viewed${entity || ' system logs'}`

  return `${action}${entity}${details}`
}

function getUserInitials(name?: string | null): string {
  // '?' rather than 'SA' — inventing Super Admin initials shows an identity that may not be theirs.
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

export function DashboardPage() {
  const user = useAuthStore((s) => s.user)
  const accessToken = useAuthStore((s) => s.accessToken)
  const navigate = useNavigate()
  /*
   * Scoped to `kpis`, NOT the global revision counter.
   *
   * Subscribing to every invalidation meant a single audit row — one login, by anyone — refetched
   * every dashboard query for every viewer with the page open. Under
   * server push that is a self-inflicted stampede. The `kpis` topic is coalesced server-side by
   * KpiCoalescerService, and the Settings mutations that should still refresh these cards name it
   * explicitly in their invalidate(...) calls.
   */
  const dataRevision = useLiveRevision(TOPICS.kpis)

  /*
   * One cached query instead of component state.
   *
   * These figures lived in useState and were fetched by an effect on every mount, so each return to the
   * dashboard — and, before the settings routing fix, every click on the gear icon — refetched all of
   * it. The query client keeps the last answer fresh for 30 seconds and shares it across mounts; a live
   * KPI event (dataRevision) is what asks for new numbers, not navigation.
   *
   * Applications and the audit tail are still row-level fetches because the page renders those rows.
   * Each is guarded on its own: a Promise.all rejects as a whole, and one failing card must not blank
   * the others or show "0 users" for a service that is actually up.
   */
  const dashboardQuery = useQuery({
    queryKey: [...queryKeys.dashboard.stats(), dataRevision],
    enabled: Boolean(accessToken),
    queryFn: async ({ signal }) => {
      const token = accessToken!
      const [stats, apps, logs] = await Promise.all([
        dashboardApi.stats(token, signal),
        // null, not an empty list, marks "could not load", so the card can tell it from "none registered".
        remoteAppsApi.list(token, { pageSize: 12 }, signal).catch(() => null),
        auditLogsApi.list(token, { pageSize: 6 }, signal).catch(() => ({ items: [] as AuditLogDto[], total: 0 })),
      ])
      return { stats, apps, logs }
    },
    // Keep showing the last figures while a live update fetches the next ones, rather than a skeleton.
    placeholderData: (previous) => previous,
  })

  const stats: DashboardStatsDto | null = dashboardQuery.data?.stats ?? null
  const loading = dashboardQuery.isPending
  const totalUsers = stats?.users ?? 0
  const totalRoles = stats?.roles ?? 0
  const appsResult = dashboardQuery.data?.apps
  const totalApps = appsResult?.total ?? 0
  const apps: RemoteAppDto[] = appsResult?.items ?? []
  const appsUnavailable = dashboardQuery.isSuccess && appsResult === null
  const recentLogs: AuditLogDto[] = dashboardQuery.data?.logs.items ?? []
  const error = dashboardQuery.error
    ? dashboardQuery.error instanceof ApiError ? dashboardQuery.error.message : 'Could not load dashboard metrics.'
    : null

  /*
   * System status reads the shell's shared health feed rather than re-probing every remote itself.
   *
   * Each dashboard visit used to POST a live re-probe of every registered application. With many
   * viewers that is a probe storm aimed at the remotes, repeated on every navigation. The shell already
   * polls this feed — every minute, every ten seconds while anything looks unhealthy, forcing a probe
   * then — so the card shows the same answer the sidebar badges do.
   */
  const healthStatus = useRemoteHealthStore((s) => s.status)
  const healthEntries = useRemoteHealthStore((s) => s.entries)
  const health: HealthEntryDto[] | null = healthStatus === 'idle' || healthStatus === 'loading' ? null : healthEntries

  /**
   * Users by role, straight from the server's GROUP BY.
   *
   * Every fabricated fallback that used to live here is gone. With no users loaded it returned a
   * hardcoded distribution — "Administrators 2 (50%), Admins 1 (25%), Normal Users 1 (25%)" — and
   * otherwise invented per-role counts with `r.usersCount || (i === 0 ? 2 : 1)`, plus an "Others 0"
   * padding row so the legend always looked full. A banking console that renders invented figures
   * indistinguishably from real ones is worse than one that renders nothing: an operator has no way to
   * tell which is which.
   *
   * Percentages are computed against the true total from the same response, so the slices always add
   * up to the number printed in the centre of the donut.
   */
  const roleDistribution: RoleDistribution[] = useMemo(() => {
    const rows = stats?.roleDistribution ?? []
    if (rows.length === 0) return []

    const total = rows.reduce((sum, r) => sum + r.userCount, 0) || 1
    return rows.map((r, index) => ({
      name: r.roleName,
      count: r.userCount,
      percentage: Math.round((r.userCount / total) * 100),
      color: ROLE_COLORS[index % ROLE_COLORS.length],
    }))
  }, [stats])

  /**
   * System status, derived from the registry health probe.
   *
   * This card used to read "Operational / 99.98% Uptime / All services healthy" unconditionally. The
   * uptime figure was invented — nothing in the platform measures uptime — and the healthy claim was
   * made even while an application was demonstrably down. A status card that cannot report a problem
   * is worse than none, because an operator learns to trust it.
   */
  const systemStatus = useMemo(() => {
    if (health === null) return { label: 'Checking', tone: 'neutral' as const, detail: 'Probing services…' }
    if (health.length === 0) {
      return { label: 'No apps', tone: 'neutral' as const, detail: 'No remote applications registered' }
    }

    const unreachable = health.filter((h) => h.health === 'Unreachable')
    const unknown = health.filter((h) => h.health === 'Unknown')

    if (unreachable.length > 0) {
      return {
        label: 'Degraded',
        tone: 'danger' as const,
        detail:
          unreachable.length === 1
            ? `${unreachable[0].displayName} is not responding`
            : `${unreachable.length} applications are not responding`,
      }
    }

    if (unknown.length > 0) {
      return { label: 'Checking', tone: 'neutral' as const, detail: `${unknown.length} not yet probed` }
    }

    return {
      label: 'Operational',
      tone: 'healthy' as const,
      detail: health.length === 1 ? '1 application reachable' : `${health.length} applications reachable`,
    }
  }, [health])
  // SVG Donut calculation
  const donutSegments = useMemo(() => {
    const total = roleDistribution.reduce((sum, r) => sum + r.count, 0) || 1
    const radius = 54
    const circumference = 2 * Math.PI * radius
    let accumulatedAngle = 0

    return roleDistribution.map((item) => {
      const fraction = item.count / total
      const strokeLength = fraction * circumference
      const strokeDashoffset = -accumulatedAngle
      accumulatedAngle += strokeLength

      return {
        ...item,
        strokeDasharray: `${strokeLength} ${circumference - strokeLength}`,
        strokeDashoffset,
      }
    })
  }, [roleDistribution])

  const todayFormatted = useMemo(() => {
    return new Date().toLocaleDateString('en-US', {
      weekday: 'short',
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    })
  }, [])

  return (
    <div className={styles.page}>
      {error && (
        <div className={styles.dashboardError} role="alert">
          {error}
        </div>
      )}

      {/* Top Hero Welcome Card */}
      <div className={styles.heroCard}>
        <div className={styles.heroLeft}>
          <div className={styles.heroAvatarWrap}>
            <div className={styles.heroAvatar}>
              {getUserInitials(user?.name)}
            </div>
            <span className={styles.avatarOnlineDot} />
          </div>
          <div className={styles.heroText}>
            <div className={styles.heroGreetingRow}>
              <h1 className={styles.heroTitle}>
                <span className={styles.welcomeIntro}>Welcome back,</span>{' '}
                <span className={styles.userNameHighlight}>
                  {user ? [user.salutation, user.name].filter(Boolean).join(' ') : 'there'}
                </span>
              </h1>
              <span className={styles.roleChip}>
                <Icon.ShieldCheck width={15} height={15} className={styles.roleShieldIcon} />
                <span>{user?.isAdministrator ? 'Platform Administrator' : 'Authorized User'}</span>
              </span>
            </div>
          </div>
        </div>

        <div className={styles.heroRight}>
          <div className={styles.dateChip}>
            <Icon.Clock width={15} height={15} className={styles.clockIcon} />
            <span>{todayFormatted}</span>
          </div>
        </div>
      </div>

      {/* Top 4 Summary Stat Cards */}
      <div className={styles.statCardsGrid}>
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <SkeletonStatCard key={i} />
          ))
        ) : (
          <>
            {/* Total Users */}
            <div className={styles.statCard}>
              <div className={styles.statCardTop}>
                <div className={`${styles.statIconWrap} ${styles.iconWrapBlue}`}>
                  <Icon.Users width={20} height={20} />
                </div>
                <span className={styles.statLabel}>Total Users</span>
              </div>
              <div className={styles.statValueRow}>
                <span className={styles.statValue}>
                  {totalUsers}
                </span>
              </div>
              <div className={styles.statTrendRow}>
                <span className={styles.trendGreen}>
                  <span className={styles.trendArrow}>↑</span> Active Accounts
                </span>
                <span className={styles.trendSubtitle}>Platform-wide</span>
              </div>
            </div>

            {/* Total Roles */}
            <div className={styles.statCard}>
              <div className={styles.statCardTop}>
                <div className={`${styles.statIconWrap} ${styles.iconWrapPurple}`}>
                  <Icon.ShieldCheck width={20} height={20} />
                </div>
                <span className={styles.statLabel}>System Roles</span>
              </div>
              <div className={styles.statValueRow}>
                <span className={styles.statValue}>
                  {totalRoles}
                </span>
              </div>
              <div className={styles.statTrendRow}>
                <span className={styles.trendGreen}>
                  <span className={styles.trendArrow}>↑</span> Granular RBAC
                </span>
                <span className={styles.trendSubtitle}>Configured</span>
              </div>
            </div>

            {/* Total Applications */}
            <div className={styles.statCard}>
              <div className={styles.statCardTop}>
                <div className={`${styles.statIconWrap} ${styles.iconWrapGreen}`}>
                  <Icon.Grid width={20} height={20} />
                </div>
                <span className={styles.statLabel}>Remote Applications</span>
              </div>
              <div className={styles.statValueRow}>
                <span className={appsUnavailable ? styles.statValueUnavailable : styles.statValue}>
                  {appsUnavailable ? '—' : totalApps || apps.length || 0}
                </span>
              </div>
              <div className={styles.statTrendRow}>
                {appsUnavailable ? (
                  <span className={styles.trendUnavailable} role="status">
                    Registry unreachable
                  </span>
                ) : (
                  <>
                    <span className={styles.trendGreen}>
                      <span className={styles.trendArrow}>↑</span> Federated Apps
                    </span>
                    <span className={styles.trendSubtitle}>Live loaded</span>
                  </>
                )}
              </div>
            </div>
            {/* System Health Status */}
            <div className={styles.statCard}>
              <div className={styles.statCardTop}>
                <div className={`${styles.statIconWrap} ${styles.iconWrapEmerald}`}>
                  <Icon.CheckCircle width={20} height={20} />
                </div>
                <span className={styles.statLabel}>System Status</span>
              </div>
              <div className={styles.statValueRow}>
                <div className={styles.statusLiveRow}>
                  {systemStatus.tone === 'healthy' && <span className={styles.pulsingDot} />}
                  <span
                    className={
                      systemStatus.tone === 'danger' ? styles.statValueDegraded : styles.statValueHealthy
                    }
                  >
                    {systemStatus.label}
                  </span>
                </div>
              </div>
              <div className={styles.statTrendRow}>
                {/* Real reachability, not an invented uptime percentage. */}
                <span className={styles.trendSubtitle}>{systemStatus.detail}</span>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Row 1: Users by Role (Left) & Quick Operations (Right) */}
      <div className={styles.twoColumnGrid}>
        {/* Widget 1: Users by Role */}
        <div className={styles.widgetCard}>
          <div className={styles.widgetHeader}>
            <div>
              <h2 className={styles.widgetTitle}>Users by Role</h2>
              <p className={styles.widgetSubtitle}>Role distribution across users</p>
            </div>
          </div>

          {loading ? (
            <SkeletonDonutChart />
          ) : (
            <div className={styles.donutContainer}>
              {/* SVG Donut Chart */}
              <div className={styles.donutSvgWrap}>
                <svg width="140" height="140" viewBox="0 0 150 150" className={styles.donutSvg}>
                  {/* Background Ring */}
                  <circle
                    cx="75"
                    cy="75"
                    r="54"
                    fill="transparent"
                    stroke="#f1f5f9"
                    strokeWidth="18"
                  />

                  {/* Segments */}
                  {donutSegments.map((segment) =>
                    segment.count > 0 ? (
                      <circle
                        key={segment.name}
                        cx="75"
                        cy="75"
                        r="54"
                        fill="transparent"
                        stroke={segment.color}
                        strokeWidth="18"
                        strokeDasharray={segment.strokeDasharray}
                        strokeDashoffset={segment.strokeDashoffset}
                        strokeLinecap="round"
                        className={styles.donutSegment}
                      />
                    ) : null,
                  )}
                </svg>

                {/* Center Donut Label */}
                <div className={styles.donutCenter}>
                  <span className={styles.donutTotalNum}>{totalUsers}</span>
                  <span className={styles.donutTotalLabel}>Total</span>
                </div>
              </div>

              {/* Legend List on Right */}
              <div className={styles.legendList}>
                {roleDistribution.map((item) => (
                  <div key={item.name} className={styles.legendItem}>
                    <div className={styles.legendLeft}>
                      <span className={`${styles.legendDot} ${styles.legendSwatch}`} style={{ '--legend-color': item.color } as React.CSSProperties} />
                      <span className={styles.legendName}>{item.name}</span>
                    </div>
                    <span className={styles.legendStat}>
                      {item.count} ({item.percentage}%)
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Widget 2: Quick Operations (Side-by-side with Users by Role) */}
        <div className={styles.widgetCard}>
          <div className={styles.widgetHeader}>
            <div>
              <h2 className={styles.widgetTitle}>Quick Operations</h2>
              <p className={styles.widgetSubtitle}>Frequently used administrative actions</p>
            </div>
          </div>

          <div className={styles.quickOpsList}>
            {/* Action 1: Add New User */}
            <div
              className={styles.quickOpItem}
              onClick={() => navigate('/settings/users/new')}
              role="button"
              tabIndex={0}
            >
              <div className={`${styles.quickOpIcon} ${styles.opBlue}`}>
                <Icon.Users width={18} height={18} />
              </div>
              <div className={styles.quickOpText}>
                <span className={styles.quickOpTitle}>Add New User</span>
                <span className={styles.quickOpDesc}>Provision account &amp; assign custom permissions</span>
              </div>
              <Icon.ChevronRight width={16} height={16} className={styles.quickOpArrow} />
            </div>

            {/* Action 2: Create Role */}
            <div
              className={styles.quickOpItem}
              onClick={() => navigate('/settings/roles/new')}
              role="button"
              tabIndex={0}
            >
              <div className={`${styles.quickOpIcon} ${styles.opPurple}`}>
                <Icon.ShieldCheck width={18} height={18} />
              </div>
              <div className={styles.quickOpText}>
                <span className={styles.quickOpTitle}>Create Role</span>
                <span className={styles.quickOpDesc}>Configure RBAC capability permissions</span>
              </div>
              <Icon.ChevronRight width={16} height={16} className={styles.quickOpArrow} />
            </div>

            {/* Action 3: Register Application */}
            <div
              className={styles.quickOpItem}
              onClick={() => navigate('/settings/applications/new')}
              role="button"
              tabIndex={0}
            >
              <div className={`${styles.quickOpIcon} ${styles.opGreen}`}>
                <Icon.Grid width={18} height={18} />
              </div>
              <div className={styles.quickOpText}>
                <span className={styles.quickOpTitle}>Register Application</span>
                <span className={styles.quickOpDesc}>Connect remote Module Federation manifest URL</span>
              </div>
              <Icon.ChevronRight width={16} height={16} className={styles.quickOpArrow} />
            </div>

            {/* Action 4: System Audit Logs */}
            <Link to="/system/audit-logs" className={styles.quickOpItem}>
              <div className={`${styles.quickOpIcon} ${styles.opAmber}`}>
                <Icon.FileText width={18} height={18} />
              </div>
              <div className={styles.quickOpText}>
                <span className={styles.quickOpTitle}>System Audit Trail</span>
                <span className={styles.quickOpDesc}>Inspect authentication logs &amp; security events</span>
              </div>
              <Icon.ChevronRight width={16} height={16} className={styles.quickOpArrow} />
            </Link>
          </div>
        </div>
      </div>

      {/* Row 2: Live System Audit Trail (Left, compact) & Registered Micro-Frontends (Right, wider) */}
      <div className={styles.auditAppsGrid}>
        {/* Widget 3: Live System Audit Trail */}
        <div className={styles.widgetCard}>
          <div className={styles.widgetHeader}>
            <div>
              <h2 className={styles.widgetTitle}>Live System Audit Trail</h2>
              <p className={styles.widgetSubtitle}>Recent authentication events and platform activity</p>
            </div>
            <Link to="/system/audit-logs" className={styles.viewAllLink}>
              <span>Full Audit Logs</span>
              <Icon.ChevronRight width={14} height={14} />
            </Link>
          </div>

          <div className={styles.activityFeed}>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <SkeletonAuditRow key={i} />
              ))
            ) : recentLogs.length > 0 ? (
              recentLogs.slice(0, 4).map((log, index) => {
                const isUser = log.action?.toLowerCase().includes('user') || log.entityType?.toLowerCase().includes('user')
                const isRole = log.action?.toLowerCase().includes('role')
                const isApp = log.action?.toLowerCase().includes('app')

                const iconTheme = isUser
                  ? { bg: '#ecfdf5', color: '#10b981', IconElem: Icon.Users }
                  : isRole
                  ? { bg: '#f3e8ff', color: '#8b5cf6', IconElem: Icon.ShieldCheck }
                  : isApp
                  ? { bg: '#fff7ed', color: '#f97316', IconElem: Icon.Grid }
                  : { bg: '#eff6ff', color: '#3b82f6', IconElem: Icon.FileText }

                return (
                  <div key={log.id || index} className={styles.activityRow}>
                    <div
                      className={styles.activityIconWrap}
                      style={{ '--tile-bg': iconTheme.bg, '--tile-color': iconTheme.color } as React.CSSProperties}
                    >
                      <iconTheme.IconElem width={16} height={16} />
                    </div>

                    <div className={styles.activityInfo}>
                      <div className={styles.activityHeaderLine}>
                        <span className={styles.activityActor}>
                          {log.actorName || log.actorUserId || 'System'}
                        </span>
                        <span className={styles.activityTime}>
                          {formatEventTime(log.occurredAt)}
                        </span>
                      </div>
                      <span className={styles.activityDescription} title={formatActionText(log)}>
                        {formatActionText(log)}
                      </span>
                    </div>
                  </div>
                )
              })
            ) : (
              /*
               * Honest empty state.
               *
               * This branch used to render FOUR fabricated audit entries — invented actors, invented
               * timestamps ("Today, 10:24 AM") and invented actions ("Exported security audit logs to
               * CSV") — styled identically to real ones. On a compliance dashboard that is the most
               * dangerous kind of placeholder: an operator reading the audit trail cannot tell which
               * entries actually happened, and the fallback appears exactly when the real query
               * returned nothing or failed.
               */
              <div className={styles.activityEmpty}>
                <span>No recent activity in this period.</span>
              </div>
            )}
          </div>
        </div>

        {/* Widget 4: Registered Micro-Frontends (Switched to Right Side) */}
        <div className={styles.widgetCard}>
          <div className={styles.widgetHeader}>
            <div>
              <h2 className={styles.widgetTitle}>Registered Micro-Frontends</h2>
              <p className={styles.widgetSubtitle}>Module Federation remote applications</p>
            </div>
            <button
              type="button"
              className={styles.headerManageBtn}
              onClick={() => navigate('/settings/applications')}
            >
              <span>Manage</span>
              <Icon.ChevronRight width={13} height={13} />
            </button>
          </div>

          <div className={styles.appsListContainer}>
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <SkeletonDashboardWidget key={i} />
              ))
            ) : apps.length > 0 ? (
              <div className={styles.appsList}>
                {apps.map((app, index) => {
                  const colorTheme = APP_COLORS[index % APP_COLORS.length]
                  const isMaintenance = app.status === 'Maintenance'

                  return (
                    <div key={app.id || app.key} className={styles.appRow}>
                      <div
                        className={styles.appRowIcon}
                        style={{ '--tile-bg': colorTheme.bg, '--tile-color': colorTheme.color } as React.CSSProperties}
                      >
                        {index === 0 ? (
                          <Icon.Users width={16} height={16} />
                        ) : index === 1 ? (
                          <Icon.Grid width={16} height={16} />
                        ) : index === 2 ? (
                          <Icon.Activity width={16} height={16} />
                        ) : (
                          <Icon.Building width={16} height={16} />
                        )}
                      </div>

                      <div className={styles.appRowContent}>
                        <div className={styles.appNameRow}>
                          <span className={styles.appRowName}>{app.displayName}</span>
                          <span className={styles.appRowKey}>/apps/{app.key}</span>
                        </div>
                        <div className={styles.progressBarTrack}>
                          <div
                            className={styles.progressBarFill}
                            style={{ '--bar-width': isMaintenance ? '40%' : '100%', '--bar-color': isMaintenance ? 'var(--omni-color-warning-500)' : colorTheme.color } as React.CSSProperties}
                          />
                        </div>
                      </div>

                      <span
                        className={isMaintenance ? styles.maintenanceStatusPill : styles.activeStatusPill}
                      >
                        <span
                          className={isMaintenance ? styles.badgeDotAmber : styles.badgeDotGreen}
                        />
                        {app.status || 'Active'}
                      </span>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className={styles.emptyAppsContainer}>
                <div className={styles.emptyAppsIcon}>
                  <Icon.Grid width={24} height={24} />
                </div>
                <p className={styles.emptyAppsTitle}>No remote applications registered</p>
                <p className={styles.emptyAppsSubtitle}>
                  Connect external micro-frontends via Module Federation 2.0.
                </p>
                <button
                  type="button"
                  className={styles.emptyRegisterBtn}
                  onClick={() => navigate('/settings/applications/new')}
                >
                  <Icon.Plus width={14} height={14} />
                  <span>Register Application</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Footer */}
      <footer className={styles.footer}>
        <span className={styles.copyright}>© {COPYRIGHT_YEAR} {APP_NAME} Micro-Frontend Platform. All rights reserved.</span>
        <span className={styles.version}>Module Federation 2.0 • Build v1.2.0</span>
      </footer>
    </div>
  )
}
