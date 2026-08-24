import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useAuthStore } from '../../../auth/store/authStore'
import { useClickOutside } from '../../../../shared/hooks/useClickOutside'
import { useMenuKeyboardNav } from '../../../../shared/hooks/useMenuKeyboardNav'
import { Icon } from '../../../../shared/components/Icon/Icon'
import { SkeletonBlock } from '../../../../shared/components/Skeleton'
import { approvalsApi } from '../../../approvals/api/approvalsApi'
import styles from './ApprovalsMenu.module.css'
import { TOPICS, useDataRevision } from '../../../../shared/stores/invalidationStore'

const ITEM_LIMIT = 8

function formatRelativeTime(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  const diffMs = Date.now() - date.getTime()
  const diffMin = Math.floor(diffMs / 60_000)
  if (diffMin < 1) return 'Just now'
  if (diffMin < 60) return `${diffMin}m ago`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr}h ago`
  const diffDay = Math.floor(diffHr / 24)
  if (diffDay < 7) return `${diffDay}d ago`
  return date.toLocaleDateString()
}

/**
 * Approval notifications in the topbar. Unlike SecurityAlertsMenu (informational alerts, badge count
 * derived from a locally-stored "last seen" heuristic), every row here is something genuinely
 * ACTIONABLE — a request sitting in this specific user's queue as the assigned checker — so the badge
 * is a real server-computed count with nothing to "mark seen": it only ever reads zero once the
 * request has actually been decided.
 */
export function ApprovalsMenu() {
  const accessToken = useAuthStore((s) => s.accessToken)
  // Bumped by ApprovalCenterPage on approve/reject and by SettingsCheckerAssignmentTab on
  // assign/remove — the same cross-component "something changed elsewhere, refetch" signal
  // DashboardPage already relies on for unrelated Settings mutations. Included in the query keys
  // below so React Query treats a bump as an immediate refetch trigger, not just the 60s poll.
  const dataRevision = useDataRevision(TOPICS.approvals)

  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useClickOutside([wrapperRef], () => setOpen(false), open)
  const handleKeyDown = useMenuKeyboardNav(wrapperRef, () => setOpen(false), triggerRef)

  const listQuery = useQuery({
    queryKey: ['assignedApprovals', ITEM_LIMIT, dataRevision],
    queryFn: () => approvalsApi.list(accessToken!, { page: 1, pageSize: ITEM_LIMIT, assignedToMe: true, status: 'Pending' }),
    enabled: Boolean(accessToken) && open,
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const summaryQuery = useQuery({
    queryKey: ['approvalSummaryBadge', dataRevision],
    queryFn: () => approvalsApi.summary(accessToken!),
    enabled: Boolean(accessToken),
    refetchInterval: 60_000,
    staleTime: 30_000,
  })

  const pendingCount = summaryQuery.data?.assignedToMePending ?? 0
  const items = listQuery.data?.items ?? []

  return (
    <div className={styles.wrapper} ref={wrapperRef} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.iconButton}
        aria-label={pendingCount > 0 ? `Approvals awaiting you, ${pendingCount} pending` : 'Approvals'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon.UserCheck width={18} height={18} />
        {pendingCount > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {pendingCount > 9 ? '9+' : pendingCount}
          </span>
        )}
      </button>

      {open && (
        <div className={styles.menu} role="menu" aria-label="Approvals awaiting you">
          <div className={styles.menuHeader}>
            <div className={styles.menuHeaderLeft}>
              <div className={styles.menuHeaderIconWrap}>
                <Icon.UserCheck width={15} height={15} />
              </div>
              <div className={styles.menuHeaderText}>
                <span className={styles.menuTitle}>Approvals</span>
                {items.length > 0 && <span className={styles.menuSubtitle}>{pendingCount} awaiting you</span>}
              </div>
            </div>
            <Link to="/system/approvals" role="menuitem" className={styles.viewAll} onClick={() => setOpen(false)}>
              <Icon.ArrowRight width={12} height={12} />
              View all
            </Link>
          </div>

          <div className={styles.menuInner}>
            {listQuery.isPending ? (
              <div className={styles.skeletonWrap}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className={styles.skeletonItem}>
                    <div className={styles.skeletonIconCol}>
                      <SkeletonBlock width={34} height={34} radius="10px" />
                    </div>
                    <div className={styles.skeletonTextCol}>
                      <SkeletonBlock width="60%" height={12} radius="4px" />
                      <SkeletonBlock width="90%" height={11} radius="4px" />
                    </div>
                  </div>
                ))}
              </div>
            ) : listQuery.isError ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIconBox} style={{ background: '#fef2f2', color: '#ef4444' }}>
                  <Icon.AlertCircle width={20} height={20} />
                </div>
                <p className={styles.emptyTitle}>Could not load approvals</p>
                <p className={styles.emptyDesc}>Check your connection and try again.</p>
              </div>
            ) : items.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={styles.emptyIconBox} style={{ background: '#ecfdf5', color: '#059669' }}>
                  <Icon.CheckCircle width={20} height={20} />
                </div>
                <p className={styles.emptyTitle}>All caught up</p>
                <p className={styles.emptyDesc}>Nothing is waiting on your approval right now.</p>
              </div>
            ) : (
              <ul className={styles.list}>
                {items.map((req) => (
                  <li key={req.id} className={styles.item}>
                    <Link to="/system/approvals" className={styles.itemLink} onClick={() => setOpen(false)}>
                      <div className={styles.alertIconBox}>
                        <Icon.Clock width={16} height={16} />
                      </div>
                      <div className={styles.itemContent}>
                        <div className={styles.itemTopRow}>
                          <span className={styles.itemTitle}>{req.action} · {req.module}</span>
                          <span className={styles.itemTime}>{formatRelativeTime(req.requestedAt)}</span>
                        </div>
                        <span className={styles.itemActor}>
                          {req.entityLabel ? `${req.entityLabel} — ` : ''}requested by {req.makerName ?? 'Unknown'}
                        </span>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {items.length > 0 && !listQuery.isPending && !listQuery.isError && (
            <div className={styles.menuFooter}>
              <Link to="/system/approvals" className={styles.footerLink} onClick={() => setOpen(false)}>
                Open Approval Center
                <Icon.ArrowRight width={12} height={12} />
              </Link>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
