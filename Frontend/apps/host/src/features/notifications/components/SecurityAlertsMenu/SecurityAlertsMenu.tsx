import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../../../auth/store/authStore'
import { useClickOutside } from '../../../../shared/hooks/useClickOutside'
import { useMenuKeyboardNav } from '../../../../shared/hooks/useMenuKeyboardNav'
import { Icon } from '../../../../shared/components/Icon/Icon'
import { SkeletonBlock } from '../../../../shared/components/Skeleton'
import { auditLogsApi } from '../../../system-audit-logs/api/auditLogsApi'
import styles from './SecurityAlertsMenu.module.css'

const ALERT_LIMIT = 8
/** Persisted per user so the unread count survives reloads without needing a server-side read model. */
const LAST_SEEN_KEY = 'omniremit:alerts-last-seen'

function readLastSeen(userId: string): number {
  try {
    const raw = localStorage.getItem(`${LAST_SEEN_KEY}:${userId}`)
    return raw ? Number(raw) : 0
  } catch {
    return 0
  }
}

function writeLastSeen(userId: string, at: number) {
  try {
    localStorage.setItem(`${LAST_SEEN_KEY}:${userId}`, String(at))
  } catch {
    // Storage can be unavailable (private mode, quota). The menu still works; only the unread
    // count resets on reload, which is a cosmetic degradation rather than a failure.
  }
}

function formatRelativeTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1)  return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24)  return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7)  return `${diffDay}d ago`
  return date.toLocaleDateString()
}

function formatFullTime(iso: string): string {
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? iso : date.toLocaleString()
}

/**
 * Security alerts in the topbar.
 *
 * Replaces a bell button that had no click handler at all — but did have a hover state, so it
 * advertised itself as interactive and then did nothing.
 *
 * Every alert is a real failed sign-in row from the audit API. There is no notifications table and
 * nothing is synthesised: if there have been no failed sign-ins, the menu says exactly that. The
 * unread count is derived from a locally stored "last seen" timestamp compared against real row
 * timestamps.
 */
export function SecurityAlertsMenu() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const userId = useAuthStore((s) => s.user?.id)

  const [open, setOpen] = useState(false)
  const [lastSeen, setLastSeen] = useState(0)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useClickOutside([wrapperRef], () => setOpen(false), open)
  const handleKeyDown = useMenuKeyboardNav(wrapperRef, () => setOpen(false), triggerRef)

  useEffect(() => {
    if (userId) setLastSeen(readLastSeen(userId))
  }, [userId])

  const alertsQuery = useQuery({
    queryKey: ['securityAlerts', ALERT_LIMIT],
    queryFn: () =>
      auditLogsApi.list(accessToken!, { page: 1, pageSize: ALERT_LIMIT, action: 'auth.login_failed' }),
    enabled: Boolean(accessToken),
    // Security alerts are the one thing worth polling in the chrome — but slowly, since this runs on
    // every page in the app.
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const alerts = alertsQuery.data?.items ?? []
  const unreadCount = alerts.filter((a) => new Date(a.occurredAt).getTime() > lastSeen).length

  function toggle() {
    const next = !open
    setOpen(next)
    // Opening marks everything currently listed as seen.
    if (next && userId) {
      const now = Date.now()
      setLastSeen(now)
      writeLastSeen(userId, now)
    }
  }

  return (
    <div className={styles.wrapper} ref={wrapperRef} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.iconButton}
        aria-label={unreadCount > 0 ? `Security alerts, ${unreadCount} new` : 'Security alerts'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <Icon.Bell width={18} height={18} />
        {unreadCount > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className={styles.menu} role="menu" aria-label="Security alerts">

          {/* ── Gradient header ── */}
          <div className={styles.menuHeader}>
            <div className={styles.menuHeaderLeft}>
              <div className={styles.menuHeaderIconWrap}>
                <Icon.Bell width={15} height={15} />
              </div>
              <div className={styles.menuHeaderText}>
                <span className={styles.menuTitle}>Security Alerts</span>
                {alerts.length > 0 && (
                  <span className={styles.menuSubtitle}>
                    {unreadCount > 0 ? `${unreadCount} new` : `${alerts.length} recent`}
                  </span>
                )}
              </div>
            </div>
            <Link
              to="/system/audit-logs"
              role="menuitem"
              className={styles.viewAll}
              onClick={() => setOpen(false)}
            >
              <Icon.ArrowRight width={12} height={12} />
              View all
            </Link>
          </div>

          {/* ── Scrollable content ── */}
          <div className={styles.menuInner}>
            {alertsQuery.isPending ? (
              /* Loading skeleton */
              <div className={styles.skeletonWrap}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className={styles.skeletonItem}>
                    <div className={styles.skeletonIconCol}>
                      <SkeletonBlock width={34} height={34} radius="10px" />
                    </div>
                    <div className={styles.skeletonTextCol}>
                      <SkeletonBlock width="60%" height={12} radius="4px" />
                      <SkeletonBlock width="90%" height={11} radius="4px" />
                      <SkeletonBlock width="45%" height={10} radius="4px" />
                    </div>
                  </div>
                ))}
              </div>
            ) : alertsQuery.isError ? (
              <div className={styles.emptyState}>
                <div className={`${styles.emptyIconBox} ${styles.emptyIconDanger}`}>
                  <Icon.AlertCircle width={20} height={20} />
                </div>
                <p className={styles.emptyTitle}>Could not load alerts</p>
                <p className={styles.emptyDesc}>Check your connection and try again.</p>
              </div>
            ) : alerts.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={`${styles.emptyIconBox} ${styles.emptyIconSuccess}`}>
                  <Icon.CheckCircle width={20} height={20} />
                </div>
                <p className={styles.emptyTitle}>All clear</p>
                <p className={styles.emptyDesc}>No failed sign-in attempts detected.</p>
              </div>
            ) : (
              <ul className={styles.list}>
                {alerts.map((alert) => {
                  const isUnread = new Date(alert.occurredAt).getTime() > lastSeen
                  return (
                    <li key={alert.id} className={`${styles.item} ${isUnread ? styles.itemUnread : ''}`}>
                      {/* Alert icon */}
                      <div className={styles.alertIconBox}>
                        <Icon.AlertCircle width={16} height={16} />
                        {isUnread && <span className={styles.unreadDot} />}
                      </div>

                      {/* Content */}
                      <div className={styles.itemContent}>
                        <div className={styles.itemTopRow}>
                          <span className={styles.itemTitle}>Failed sign-in</span>
                          <span className={styles.itemTime} title={formatFullTime(alert.occurredAt)}>
                            {formatRelativeTime(alert.occurredAt)}
                          </span>
                        </div>

                        <span className={styles.itemActor}>
                          {alert.actorName ?? 'Unknown account'}
                        </span>

                        <div className={styles.itemTagRow}>
                          {alert.sourceIp && (
                            <span className={styles.ipTag}>{alert.sourceIp}</span>
                          )}
                          {alert.failureReason && (
                            <span className={styles.reasonTag}>{alert.failureReason}</span>
                          )}
                        </div>
                      </div>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>

          {/* ── Footer ── */}
          {alerts.length > 0 && !alertsQuery.isPending && !alertsQuery.isError && (
            <div className={styles.menuFooter}>
              <Link
                to="/system/audit-logs"
                className={styles.footerLink}
                onClick={() => setOpen(false)}
              >
                View full audit log
                <Icon.ArrowRight width={12} height={12} />
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
