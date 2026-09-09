import { useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { isDrawerRoute, useSettingsDrawerStore } from '../../shared/stores/settingsDrawerStore'
import { useClickOutside } from '../../shared/hooks/useClickOutside'
import { useMenuKeyboardNav } from '../../shared/hooks/useMenuKeyboardNav'
import { useAuthStore } from '../../features/auth/store/authStore'
import { GlobalSearch } from '../../features/search/components/GlobalSearch/GlobalSearch'
import { SecurityAlertsMenu } from '../../features/notifications/components/SecurityAlertsMenu/SecurityAlertsMenu'
import { ApprovalsMenu } from '../../features/notifications/components/ApprovalsMenu/ApprovalsMenu'
import { Icon } from '../../shared/components/Icon/Icon'
import styles from './Topbar.module.css'

export interface TopbarSettingsAccess {
  users: boolean
  roles: boolean
  applications: boolean
}

export interface TopbarProps {
  userName?: string
  settingsAccess?: TopbarSettingsAccess
  onLogout?: () => void
  /** Mobile: callback to toggle the sidebar open/closed */
  onMobileMenuToggle?: () => void
}

function getUserInitials(name?: string | null): string {
  // '?' rather than 'SA'. Falling back to "Super Admin" initials paints an identity that may not be
  // the viewer's own — in a banking console, showing someone the wrong identity is worse than
  // showing none.
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return name.slice(0, 2).toUpperCase()
}

export function Topbar({ userName, settingsAccess, onLogout, onMobileMenuToggle }: TopbarProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef      = useRef<HTMLDivElement>(null)
  const triggerRef   = useRef<HTMLButtonElement>(null)

  const location = useLocation()
  const navigate = useNavigate()
  // Navigates rather than opening the store directly, so the gear icon produces a real URL.
  const openSettings = () => {
    if (!isDrawerRoute(location.pathname)) {
      useSettingsDrawerStore.getState().setReturnPath(`${location.pathname}${location.search}`)
    }
    navigate('/settings')
  }
  // The signed-in user's real role, for the menu header. See the comment on that header below.
  const user = useAuthStore((s) => s.user)

  useClickOutside([menuRef], () => setMenuOpen(false), menuOpen)
  const handleKeyDown = useMenuKeyboardNav(menuRef, () => setMenuOpen(false), triggerRef)

  const canAccessSettings = Boolean(
    settingsAccess?.users || settingsAccess?.roles || settingsAccess?.applications
  )
  const displayName = userName || user?.name || '—'

  return (
    <header className={styles.topbar}>

      {/* Hamburger — only visible on mobile via CSS, always mounted for clean transitions */}
      <button
        type="button"
        className={styles.hamburgerBtn}
        onClick={onMobileMenuToggle}
        aria-label="Toggle navigation menu"
      >
        <Icon.Menu width={20} height={20} />
      </button>

      {/*
        Real search. This was a bare <input> with no handler — typing in it did nothing at all.
        GlobalSearch queries GET /api/search, which filters results per entity type against the
        caller's own permissions, so a user never sees a record they could not open.
      */}
      <GlobalSearch />

      {/* Right actions */}
      <div className={styles.actions}>

        {/* Settings gear */}
        {canAccessSettings && (
          <button
            type="button"
            className={styles.iconButton}
            aria-label="Settings"
            title="System Settings"
            onClick={openSettings}
          >
            <Icon.Settings width={17} height={17} />
          </button>
        )}

        {/*
          Real notifications. The bell was a dead button with a red dot that was ALWAYS lit — it
          signalled "you have alerts" permanently, whether or not anything had happened, which trains
          an operator to ignore it. SecurityAlertsMenu reads genuine failed sign-ins from the audit log
          and shows the dot only when there are recent ones.
        */}
        <SecurityAlertsMenu />

        {/* Approvals awaiting the signed-in user as checker — every gated request lands here as soon
            as it's assigned, badge count is a real server figure (see ApprovalsMenu's own doc comment
            for why it doesn't use SecurityAlertsMenu's "last seen" heuristic). */}
        <ApprovalsMenu />

        <div className={styles.actionsDivider} aria-hidden="true" />

        {/* User pill */}
        <div className={styles.menuWrapper} ref={menuRef} onKeyDown={handleKeyDown}>
          <button
            ref={triggerRef}
            type="button"
            className={styles.userButton}
            onClick={() => setMenuOpen((o) => !o)}
            aria-haspopup="menu"
            aria-expanded={menuOpen}
          >
            <span className={styles.avatar} aria-hidden="true">
              {getUserInitials(userName)}
            </span>
            <span className={styles.userName}>{displayName}</span>
            <Icon.ChevronDown width={13} height={13} className={styles.userChevron} />
          </button>

          {menuOpen && (
            <div className={styles.menu} role="menu">

              {/* User header */}
              <div className={styles.menuUserHeader}>
                <span className={styles.menuUserHeaderAvatar} aria-hidden="true">
                  {getUserInitials(userName)}
                </span>
                <div className={styles.menuUserHeaderInfo}>
                  <span className={styles.menuUserHeaderName}>{displayName}</span>
                  {/*
                    The user's ACTUAL role. This was the literal string "Platform Administrator" for
                    everyone — a View-only teller opened this menu and was told they were a platform
                    administrator. Misreporting someone's own privilege level in a banking console is
                    worse than showing nothing, so an unassigned role now says so plainly.
                  */}
                  <span className={styles.menuUserHeaderRole}>
                    {user?.roleName ?? 'No role assigned'}
                  </span>
                </div>
              </div>
              <div className={styles.menuDivider} />

              <Link
                to="/profile"
                role="menuitem"
                className={styles.menuItem}
                onClick={() => setMenuOpen(false)}
              >
                <Icon.Users width={15} height={15} />
                <span>My Profile</span>
              </Link>

              <div className={styles.menuDivider} />

              <button
                type="button"
                role="menuitem"
                className={`${styles.menuItem} ${styles.menuItemDanger}`}
                onClick={() => { setMenuOpen(false); onLogout?.() }}
              >
                <Icon.LogOut width={15} height={15} />
                <span>Sign out</span>
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
