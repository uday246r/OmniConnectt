import { useEffect, useRef, useState } from 'react'
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
const DISMISSED_APPROVALS_KEY = 'omniremit:dismissed-approvals'

function readDismissed(userId: string): Set<string> {
  try {
    const raw = localStorage.getItem(`${DISMISSED_APPROVALS_KEY}:${userId}`)
    return raw ? new Set(JSON.parse(raw)) : new Set()
  } catch {
    return new Set()
  }
}

function writeDismissed(userId: string, ids: Set<string>) {
  try {
    localStorage.setItem(`${DISMISSED_APPROVALS_KEY}:${userId}`, JSON.stringify(Array.from(ids)))
  } catch {
    // Storage can be unavailable
  }
}

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
 * Approval notifications in the topbar. Dismissing an approval notification removes it
 * from the local UI state without modifying database records.
 */
export function ApprovalsMenu() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const userId = useAuthStore((s) => s.user?.id)
  const dataRevision = useDataRevision(TOPICS.approvals)

  const [open, setOpen] = useState(false)
  const [dismissedIds, setDismissedIds] = useState<Set<string>>(() =>
    userId ? readDismissed(userId) : new Set()
  )
  const wrapperRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useClickOutside([wrapperRef], () => setOpen(false), open)
  const handleKeyDown = useMenuKeyboardNav(wrapperRef, () => setOpen(false), triggerRef)

  useEffect(() => {
    if (userId) {
      setDismissedIds(readDismissed(userId))
    }
  }, [userId])

  const listQuery = useQuery({
    queryKey: ['assignedApprovals', ITEM_LIMIT, dataRevision],
    queryFn: () => approvalsApi.list(accessToken!, { page: 1, pageSize: ITEM_LIMIT, assignedToMe: true, status: 'Pending' }),
    enabled: Boolean(accessToken),
    staleTime: 30_000,
  })

  const summaryQuery = useQuery({
    queryKey: ['approvalSummaryBadge', dataRevision],
    queryFn: () => approvalsApi.summary(accessToken!),
    enabled: Boolean(accessToken),
    staleTime: 30_000,
  })

  const rawItems = listQuery.data?.items ?? []
  const visibleItems = rawItems.filter((req) => !dismissedIds.has(String(req.id)))
  const pendingCount = summaryQuery.data?.assignedToMePending ?? 0
  const dismissedCount = rawItems.filter((req) => dismissedIds.has(String(req.id))).length
  const effectiveBadgeCount = Math.max(0, pendingCount - dismissedCount)

  function dismissSingle(reqId: string | number, e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDismissedIds((prev) => {
      const next = new Set(prev)
      next.add(String(reqId))
      if (userId) writeDismissed(userId, next)
      return next
    })
  }

  function dismissAll(e: React.MouseEvent) {
    e.preventDefault()
    e.stopPropagation()
    setDismissedIds((prev) => {
      const next = new Set(prev)
      for (const req of rawItems) next.add(String(req.id))
      if (userId) writeDismissed(userId, next)
      return next
    })
  }

  return (
    <div className={styles.wrapper} ref={wrapperRef} onKeyDown={handleKeyDown}>
      <button
        ref={triggerRef}
        type="button"
        className={styles.iconButton}
        aria-label={effectiveBadgeCount > 0 ? `Approvals awaiting you, ${effectiveBadgeCount} pending` : 'Approvals'}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        <Icon.UserCheck width={18} height={18} />
        {effectiveBadgeCount > 0 && (
          <span className={styles.badge} aria-hidden="true">
            {effectiveBadgeCount > 9 ? '9+' : effectiveBadgeCount}
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
                {visibleItems.length > 0 && <span className={styles.menuSubtitle}>{visibleItems.length} awaiting you</span>}
              </div>
            </div>
            <div className={styles.menuHeaderActions}>
              {visibleItems.length > 0 && (
                <button
                  type="button"
                  className={styles.clearAllBtn}
                  onClick={dismissAll}
                  title="Clear all approvals from notification list"
                >
                  Clear all
                </button>
              )}
              <Link to="/system/approvals" role="menuitem" className={styles.viewAll} onClick={() => setOpen(false)}>
                <Icon.ArrowRight width={12} height={12} />
                View all
              </Link>
            </div>
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
                <div className={`${styles.emptyIconBox} ${styles.emptyIconDanger}`}>
                  <Icon.AlertCircle width={20} height={20} />
                </div>
                <p className={styles.emptyTitle}>Could not load approvals</p>
                <p className={styles.emptyDesc}>Check your connection and try again.</p>
              </div>
            ) : visibleItems.length === 0 ? (
              <div className={styles.emptyState}>
                <div className={`${styles.emptyIconBox} ${styles.emptyIconSuccess}`}>
                  <Icon.CheckCircle width={20} height={20} />
                </div>
                <p className={styles.emptyTitle}>All caught up</p>
                <p className={styles.emptyDesc}>Nothing is waiting on your approval right now.</p>
              </div>
            ) : (
              <ul className={styles.list}>
                {visibleItems.map((req) => (
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
                    <button
                      type="button"
                      className={styles.dismissBtn}
                      onClick={(e) => dismissSingle(req.id, e)}
                      title="Dismiss notification"
                      aria-label="Dismiss notification"
                    >
                      <Icon.X width={13} height={13} />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {visibleItems.length > 0 && !listQuery.isPending && !listQuery.isError && (
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
