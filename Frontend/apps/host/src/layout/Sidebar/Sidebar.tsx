import { useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { useAuthStore, isSuperAdminOrAdmin } from '../../features/auth/store/authStore'
import { visibleSettingsGroups } from '../../shared/settings/settingsSections'
import { classNames } from '../../shared/utils/classNames'
import { SkeletonBlock } from '../../shared/components/Skeleton'
import { Icon } from '../../shared/components/Icon/Icon'
import { resolveIcon } from '../../shared/components/Icon/resolveIcon'
import { BrandMark } from '../../shared/components/BrandMark/BrandMark'
import { navItemStyles } from '@omniconnect/ui'
import { useNavigationStore } from '../../shared/stores/navigationStore'
import type { NavNodeDto } from '../../shared/api/navigationApi'
import styles from './Sidebar.module.css'
import { APP_NAME } from '../../shared/config/branding'

export interface SidebarProps {
  /** Health per app key, overlaid from the registry. Not part of the navigation tree — see below. */
  health?: Record<string, 'Unknown' | 'Healthy' | 'Unreachable'>
  /** Mobile: whether the sidebar is slid in over the content */
  mobileOpen?: boolean
  /** Mobile: called when the user taps the backdrop or a close trigger */
  onMobileClose?: () => void
}

/*
 * The host renders the entire sidebar from GET /api/navigation, and owns every part of it: the rows,
 * the chevrons, the expand/collapse state and the active state.
 *
 * What this replaces is worth remembering. Each remote used to locate the host's own <a href="/apps/…">
 * by query selector, appendChild a hand-built chevron button with an inline SVG onto it, create a
 * sibling div and portal its sub-menu into that — retrying every 150ms for four seconds until the
 * host element appeared. The host cooperated by hardcoding '.lead-sidebar-chevron-btn,
 * .c360-sidebar-chevron-btn' and synthesising clicks on whatever matched. Two applications wrote into
 * one element, each remote kept its own copy of the expand state, and their submenu items were
 * hardcoded arrays with a `visible` boolean for permissions.
 *
 * Now: the server decides what exists and who may see it, and this component renders exactly that.
 */

function navItemClass({ isActive }: { isActive: boolean }) {
  return classNames(navItemStyles.navItem, isActive && navItemStyles.navItemActive)
}

/** Health is deliberately not part of the tree — it changes on a probe interval, so it is overlaid here. */
function unreachableBadge(node: NavNodeDto, health: SidebarProps['health']) {
  const appKey = node.remote?.appKey
  if (!appKey || health?.[appKey] !== 'Unreachable') return null
  return (
    <span className={styles.unreachableBadge} title="App server not responding">!</span>
  )
}

function StateBadge({ node }: { node: NavNodeDto }) {
  // An operator who may open an app in maintenance still sees that it is in maintenance.
  if (node.state === 'maintenance' || node.state === 'maintenance-bypass') {
    const title = node.maintenanceMessage ?? 'Under maintenance'
    return (
      <span
        className={navItemStyles.navItemBadge}
        title={node.state === 'maintenance-bypass' ? `${title} (you have maintenance access)` : title}
      >
        <Icon.AlertTriangle width={13} height={13} />
      </span>
    )
  }
  return null
}

function NavRow({ node, health }: { node: NavNodeDto; health: SidebarProps['health'] }) {
  const expanded = useNavigationStore((s) => s.expanded)
  const toggleExpanded = useNavigationStore((s) => s.toggleExpanded)

  const hasChildren = node.children.length > 0
  const isOpen = expanded.has(node.key)
  const NodeIcon = resolveIcon(node.iconKey)

  /*
   * A row with children is a GROUP HEADER, not a link — the whole row toggles it, and the chevron is
   * an indicator inside that one control rather than a second control beside it.
   *
   * Previously the row was a link and only the little chevron toggled, so clicking the app name
   * opened the group but clicking it again could not close it: the click navigated instead, and
   * landing back on a child route immediately re-expanded the group. Making the row itself the
   * toggle is the standard accordion behaviour and removes that dead end.
   *
   * It also removes an accessibility problem. The chevron used to be a button sitting next to an
   * anchor covering the same row, so the group had two tab stops that looked like one thing. Now
   * there is one control, and `aria-expanded` on it says what it does.
   *
   * The children are the navigation targets. An app is still reachable directly at /apps/{key} by
   * URL, which redirects to its first visible page.
   */
  if (hasChildren) {
    return (
      <>
        <div className={styles.rowWrap}>
          <button
            type="button"
            className={classNames(
              navItemStyles.navItem,
              styles.groupHeader,
              node.state !== 'visible' && navItemStyles.navItemLocked,
            )}
            aria-expanded={isOpen}
            title={node.maintenanceMessage ?? undefined}
            onClick={() => toggleExpanded(node.key)}
          >
            <span className={navItemStyles.navIcon} aria-hidden="true">
              <NodeIcon width={17} height={17} />
            </span>
            <span className={navItemStyles.navLabel}>{node.label}</span>
            {unreachableBadge(node, health)}
            <StateBadge node={node} />
            <span
              className={classNames(navItemStyles.navChevron, isOpen && navItemStyles.navChevronOpen)}
              aria-hidden="true"
            >
              <Icon.ChevronRight width={14} height={14} />
            </span>
          </button>
        </div>

        {isOpen && (
          <div className={navItemStyles.navChildren}>
            {node.children.map((child) => {
              const ChildIcon = resolveIcon(child.iconKey)
              return (
                <NavLink
                  key={child.key}
                  to={child.routePath}
                  className={({ isActive }) =>
                    classNames(
                      navItemClass({ isActive }),
                      navItemStyles.navChildItem,
                      child.state !== 'visible' && navItemStyles.navItemLocked,
                    )
                  }
                  title={child.maintenanceMessage ?? undefined}
                >
                  <span className={navItemStyles.navIcon} aria-hidden="true">
                    <ChildIcon width={15} height={15} />
                  </span>
                  <span className={navItemStyles.navLabel}>{child.label}</span>
                  <StateBadge node={child} />
                </NavLink>
              )
            })}
          </div>
        )}
      </>
    )
  }

  return (
    <>
      <div className={styles.rowWrap}>
        <NavLink
          to={node.routePath}
          end={node.routePath === '/'}
          className={({ isActive }) =>
            classNames(navItemClass({ isActive }), node.state !== 'visible' && navItemStyles.navItemLocked)
          }
          title={node.maintenanceMessage ?? undefined}
        >
          <span className={navItemStyles.navIcon} aria-hidden="true">
            <NodeIcon width={17} height={17} />
          </span>
          <span className={navItemStyles.navLabel}>{node.label}</span>
          {unreachableBadge(node, health)}
          <StateBadge node={node} />
        </NavLink>
      </div>
    </>
  )
}

export function Sidebar({ health, mobileOpen }: SidebarProps) {
  const status = useNavigationStore((s) => s.status)
  const sections = useNavigationStore((s) => s.sections)
  const error = useNavigationStore((s) => s.error)
  const expanded = useNavigationStore((s) => s.expanded)
  const toggleExpanded = useNavigationStore((s) => s.toggleExpanded)
  const setExpanded = useNavigationStore((s) => s.setExpanded)
  const location = useLocation()

  const isAdministrator = useAuthStore((s) => isSuperAdminOrAdmin(s.user))
  const hasCapability = useAuthStore((s) => s.hasCapability)
  const can = (featureKey: string, capability = 'View') => isAdministrator || hasCapability(featureKey, capability)
  const settingsGroups = visibleSettingsGroups(can)

  // Open the group containing the current route, so a refresh onto /apps/lead/view-lead shows that
  // row highlighted inside an expanded parent rather than collapsed and apparently absent.
  useEffect(() => {
    for (const section of sections) {
      for (const item of section.items) {
        if (item.children.some((c) => location.pathname.startsWith(c.routePath))) {
          setExpanded(item.key, true)
        }
      }
    }
    if (location.pathname.startsWith('/settings') || location.pathname.startsWith('/system')) {
      setExpanded('settings:collapsed', false)
    }
  }, [location.pathname, sections, setExpanded])

  return (
    <aside className={classNames(styles.sidebar, mobileOpen ? styles.sidebarMobileOpen : '')}>
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

      <nav className={styles.nav} aria-label="Primary">
        {status === 'loading' &&
          sections.length === 0 &&
          Array.from({ length: 5 }, (_, i) => (
            <div className={styles.skeletonItem} key={i}>
              <SkeletonBlock height={34} />
            </div>
          ))}

        {error && <div className={styles.errorState} role="status">{error}</div>}

        {sections.map((section) => {
          if (section.key === 'system') {
            if (settingsGroups.length === 0) return null
            const myRequestsNode = section.items.find((item) => item.key === 'host.my-requests')
            const isSettingsOpen = !expanded.has('settings:collapsed')

            return (
              <div key={section.key} className={styles.systemSection}>
                <div className={styles.rowWrap}>
                  <button
                    type="button"
                    className={classNames(
                      navItemStyles.navItem,
                      styles.groupHeader,
                      styles.settingsAccordionBtn,
                    )}
                    aria-expanded={isSettingsOpen}
                    onClick={() => toggleExpanded('settings:collapsed')}
                  >
                    <span className={navItemStyles.navIcon} aria-hidden="true">
                      <Icon.Settings width={17} height={17} />
                    </span>
                    <span className={navItemStyles.navLabel}>Settings</span>
                    <span
                      className={classNames(
                        navItemStyles.navChevron,
                        isSettingsOpen && navItemStyles.navChevronOpen,
                      )}
                      aria-hidden="true"
                    >
                      <Icon.ChevronRight width={14} height={14} />
                    </span>
                  </button>
                </div>

                {isSettingsOpen && (
                  <div className={styles.settingsSubmenu}>
                    {settingsGroups.map((group) => (
                      <div key={group.category} className={styles.sidebarGroupBlock}>
                        <div className={styles.categorySubLabel}>{group.category}</div>
                        {group.items.map((item) => {
                          const ItemIcon = resolveIcon(item.icon, Icon.Settings)
                          return (
                            <div key={item.tab} className={styles.rowWrap}>
                              <NavLink
                                to={item.routePath}
                                className={({ isActive }) =>
                                  classNames(navItemClass({ isActive }))
                                }
                              >
                                <span className={navItemStyles.navIcon} aria-hidden="true">
                                  <ItemIcon width={16} height={16} />
                                </span>
                                <span className={navItemStyles.navLabel}>{item.label}</span>
                              </NavLink>
                            </div>
                          )
                        })}
                      </div>
                    ))}
                    {myRequestsNode && (
                      <div className={styles.sidebarGroupBlock}>
                        <NavRow key={myRequestsNode.key} node={myRequestsNode} health={health} />
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          }

          return (
            <div key={section.key} className={section.pinToBottom ? styles.systemSection : undefined}>
              {/* Section labels come from the server too — the host no longer hardcodes "Main"/"Apps". */}
              <div className={styles.sectionLabel}>{section.label}</div>
              {section.items.map((item) => (
                <NavRow key={item.key} node={item} health={health} />
              ))}
            </div>
          )
        })}
      </nav>
    </aside>
  )
}
