import { NavLink } from 'react-router-dom'
import { classNames } from '../../shared/utils/classNames'
import { SkeletonBlock } from '../../shared/components/Skeleton'
import { Icon } from '../../shared/components/Icon/Icon'
import { resolveIcon } from '../../shared/components/Icon/resolveIcon'
import { BrandMark } from '../../shared/components/BrandMark/BrandMark'
import { navItemStyles } from '@omniremit/ui'
import styles from './Sidebar.module.css'
import { APP_NAME } from '../../shared/config/branding'

export interface SidebarAppItem {
  key: string
  displayName: string
  iconKey?: string | null
  health?: 'Unknown' | 'Healthy' | 'Unreachable'
}

export interface SidebarProps {
  apps?: SidebarAppItem[]
  canAccessAuditLogs?: boolean
  canAccessApprovals?: boolean
  error?: string | null
  userName?: string
  onLogout?: () => void
  /** Mobile: whether the sidebar is slid in over the content */
  mobileOpen?: boolean
  /** Mobile: called when the user taps the backdrop or a close trigger */
  onMobileClose?: () => void
}

/*
 * Row classes come from @omniremit/ui so the host's own nav rows and the sub-navigation rows the
 * remotes portal into this very sidebar are the same stylesheet rather than two copies that had
 * drifted on padding, gap, radius and font-size. The markup stays a NavLink — the chevron/portal
 * coordination documented below depends on it.
 */
function navItemClass({ isActive }: { isActive: boolean }) {
  return classNames(navItemStyles.navItem, isActive && navItemStyles.navItemActive)
}

// Each remote with an expandable sub-menu (Customer 360, Lead Management) injects its own chevron
// toggle button as a DOM child of this NavLink — see HostSidebarCustomer360Nav.tsx /
// HostSidebarLeadNav.tsx, which portal their sub-nav in and `appendChild` the chevron directly onto
// the anchor found by this same href. The host has no direct handle on that button or the remote's
// expand/collapse state, so "click anywhere on the row toggles it" is done by finding whichever
// chevron is present at click time (it can mount up to ~4s after the remote loads, hence a live
// query rather than a cached ref) and forwarding the click to it — a real click event, not touching
// the remote's internal state directly.
//
// This only ever fires for clicks that DIDN'T land on the chevron itself: the chevron's own onclick
// calls stopPropagation() in the bubble phase, which stops this row-level onClick (registered via
// React's root-level delegated listener) from also running — so clicking the chevron toggles once,
// not twice.
const SUB_NAV_CHEVRON_SELECTOR = '.c360-sidebar-chevron-btn, .lead-sidebar-chevron-btn'

function forwardClickToChevron(e: React.MouseEvent<HTMLAnchorElement>) {
  const chevron = e.currentTarget.querySelector<HTMLButtonElement>(SUB_NAV_CHEVRON_SELECTOR)
  if (chevron) {
    e.preventDefault()
    chevron.click()
  }
  // No chevron found (app has no sub-menu, or the remote hasn't mounted its chevron yet) — let the
  // NavLink navigate normally.
}

export function Sidebar({ apps, canAccessAuditLogs, canAccessApprovals, error, mobileOpen }: SidebarProps) {
  return (
    <aside className={classNames(styles.sidebar, mobileOpen ? styles.sidebarMobileOpen : '')}>

      {/* ── Brand ─────────────────────────────────────────── */}
      <div className={styles.brand}>
        <BrandMark size={34} />
        <div className={styles.brandNames}>
          <span className={styles.brandName}>
            {/* Name from config; split only so the two-tone styling still applies. */}
            <span className={styles.brandOmni}>{APP_NAME.slice(0, 4)}</span>
            <span className={styles.brandAccent}>{APP_NAME.slice(4)}</span>
          </span>
        </div>
      </div>

      {/* ── Navigation — everything lives inside here ─────── */}
      <nav className={styles.nav} aria-label="Primary">

        {/* Dashboard */}
        <div className={styles.sectionLabel}>Main</div>
        <NavLink to="/" end className={navItemClass}>
          <span className={navItemStyles.navIcon} aria-hidden="true">
            <Icon.Home width={17} height={17} />
          </span>
          <span className={navItemStyles.navLabel}>Dashboard</span>
        </NavLink>

        {/* Apps section — remote apps inject entries here */}
        <div className={styles.sectionLabel}>Apps</div>

        {/* Loading */}
        {apps === undefined &&
          Array.from({ length: 3 }, (_, i) => (
            <div className={styles.skeletonItem} key={i}>
              <SkeletonBlock height={34} />
            </div>
          ))}

        {/* Error */}
        {error && (
          <div className={styles.errorState} role="status">{error}</div>
        )}

        {/* Empty */}
        {!error && apps?.length === 0 && (
          <div className={styles.emptyState}>No apps registered yet.</div>
        )}

        {/* App links */}
        {apps?.map((app) => {
          const isUnreachable = app.health === 'Unreachable'
          // The registry stores an icon per app; every entry was rendered with the same Users icon, so
          // a Helpdesk and an Inventory app were visually identical in the nav.
          const AppIcon = resolveIcon(app.iconKey)
          return (
            <NavLink
              key={app.key}
              to={`/apps/${app.key}`}
              className={({ isActive }) =>
                classNames(navItemClass({ isActive }), isUnreachable && styles.navItemUnreachable)
              }
              title={isUnreachable ? `${app.displayName} is not responding` : undefined}
              onClick={forwardClickToChevron}
            >
              <span className={navItemStyles.navIcon} aria-hidden="true">
                <AppIcon width={17} height={17} />
              </span>
              <span className={navItemStyles.navLabel}>{app.displayName}</span>
              {isUnreachable && (
                <span className={styles.unreachableBadge} title="App server not responding">!</span>
              )}
            </NavLink>
          )
        })}

        {/* ── System section — pushed to bottom of nav with margin-top: auto
            so it sits right below the apps list, never floats to the bottom
            of 100vh creating a giant empty gap ─────────────────────────── */}
        {/* "My Requests" is shown to every authenticated user — it tracks their own submitted
            requests regardless of whether they hold Approval Center or Audit Log access, since
            approvalsApi.listMine is scoped to the caller's own id server-side. */}
        <div className={styles.systemSection}>
          <div className={styles.sectionLabel}>System</div>
          {canAccessApprovals && (
            <NavLink to="/system/approvals" className={navItemClass}>
              <span className={navItemStyles.navIcon} aria-hidden="true">
                <Icon.UserCheck width={17} height={17} />
              </span>
              <span className={navItemStyles.navLabel}>Approval Center</span>
            </NavLink>
          )}
          {/*
            Shown to everyone, administrators included.

            This was previously hidden from administrators on the grounds that they never create
            approval requests. That is only true of SUPER administrators: UsersController passes
            `bypassApproval: IsSuperAdmin()`, so any other administrator is an ordinary maker whose
            gated mutations queue like anybody else's. Hiding the page left them with no way to
            collect the temporary password for an account they had just created — the button exists
            only on this page. An empty page for the few who genuinely never make requests is a far
            smaller cost than an unreachable credential.
          */}
          <NavLink to="/my-requests" className={navItemClass}>
            <span className={navItemStyles.navIcon} aria-hidden="true">
              <Icon.Clock width={17} height={17} />
            </span>
            <span className={navItemStyles.navLabel}>My Requests</span>
          </NavLink>
          {canAccessAuditLogs && (
            <NavLink to="/system/audit-logs" className={navItemClass}>
              <span className={navItemStyles.navIcon} aria-hidden="true">
                <Icon.FileText width={17} height={17} />
              </span>
              <span className={navItemStyles.navLabel}>Audit Logs</span>
            </NavLink>
          )}
        </div>

      </nav>

    </aside>
  )
}
