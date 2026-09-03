import { useEffect } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import { classNames } from '../../shared/utils/classNames'
import { SkeletonBlock } from '../../shared/components/Skeleton'
import { Icon } from '../../shared/components/Icon/Icon'
import { resolveIcon } from '../../shared/components/Icon/resolveIcon'
import { BrandMark } from '../../shared/components/BrandMark/BrandMark'
import { navItemStyles } from '@omniremit/ui'
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
  if (node.state === 'maintenance') {
    return (
      <span className={navItemStyles.navItemBadge} title={node.maintenanceMessage ?? 'Under maintenance'}>
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

  return (
    <>
      <div className={styles.rowWrap}>
        <NavLink
          to={node.routePath}
          /*
           * `end` for any row that has children, not just the dashboard.
           *
           * Without it a NavLink to /apps/lead also matches /apps/lead/view-lead, so both the parent
           * and the child were marked aria-current="page" at once. Only one row can be the current
           * page, and announcing two leaves a screen-reader user unable to tell which. The parent
           * still reads as containing the active page because it is expanded and its child is
           * highlighted.
           */
          end={node.routePath === '/' || hasChildren}
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

        {/*
          A real button, outside the link rather than appended inside it. Keeping it a sibling is what
          makes "expand" and "navigate" two distinct, independently keyboard-reachable actions —
          nesting an interactive control inside an anchor is invalid, and was the reason the old code
          had to intercept clicks and re-dispatch them.
        */}
        {hasChildren && (
          <button
            type="button"
            className={classNames(navItemStyles.navChevron, isOpen && navItemStyles.navChevronOpen)}
            aria-expanded={isOpen}
            aria-label={`${isOpen ? 'Collapse' : 'Expand'} ${node.label}`}
            onClick={() => toggleExpanded(node.key)}
          >
            <Icon.ChevronRight width={14} height={14} />
          </button>
        )}
      </div>

      {hasChildren && isOpen && (
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

export function Sidebar({ health, mobileOpen }: SidebarProps) {
  const status = useNavigationStore((s) => s.status)
  const sections = useNavigationStore((s) => s.sections)
  const error = useNavigationStore((s) => s.error)
  const setExpanded = useNavigationStore((s) => s.setExpanded)
  const location = useLocation()

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

        {sections.map((section) => (
          <div key={section.key} className={section.pinToBottom ? styles.systemSection : undefined}>
            {/* Section labels come from the server too — the host no longer hardcodes "Main"/"Apps". */}
            <div className={styles.sectionLabel}>{section.label}</div>
            {section.items.map((item) => (
              <NavRow key={item.key} node={item} health={health} />
            ))}
          </div>
        ))}
      </nav>
    </aside>
  )
}
