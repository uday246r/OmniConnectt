import { useEffect, useRef, type ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../features/auth/store/authStore'
import { isDrawerRoute, useSettingsDrawerStore, type SettingsTab } from '../../shared/stores/settingsDrawerStore'
import { Icon } from '../../shared/components/Icon/Icon'
import { SettingsRolesTab } from './SettingsRolesTab'
import { SettingsApplicationsTab } from './SettingsApplicationsTab'
import { SettingsCheckerAssignmentTab } from './SettingsCheckerAssignmentTab'
import { RoleFormLayer } from './RoleFormLayer'
import { UserFormLayer } from './UserFormLayer'
import { ApplicationFormLayer } from './ApplicationFormLayer'
import { CheckerAssignmentFormLayer } from './CheckerAssignmentFormLayer'
import { visibleSettingsSections } from '../../shared/settings/settingsSections'
import styles from './SettingsDrawer.module.css'

/** The panel each drawer section renders. A drawer section added to SETTINGS_SECTIONS needs its panel here. */
const SECTION_PANELS: Partial<Record<SettingsTab, ComponentType>> = {
  roles: SettingsRolesTab,
  applications: SettingsApplicationsTab,
  'checker-assignment': SettingsCheckerAssignmentTab,
}

export function SettingsDrawer() {
  const isOpen = useSettingsDrawerStore((s) => s.isOpen)
  const activeTab = useSettingsDrawerStore((s) => s.activeTab)
  const layerStack = useSettingsDrawerStore((s) => s.layerStack)
  const popLayer = useSettingsDrawerStore((s) => s.popLayer)
  const closeDrawerStore = useSettingsDrawerStore((s) => s.close)
  const drawerRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()

  /*
   * Switching tabs and closing are NAVIGATIONS, not direct store writes.
   *
   * The URL is the source of truth for which tab is open — SettingsDrawerUrlSync reacts to it.
   * Writing straight to the store here would move the drawer without moving the address bar, which is
   * exactly the behaviour being fixed: nothing was linkable and Back did not step between tabs.
   */
  const goToTab = (tab: SettingsTab) => navigate(`/settings/${tab}`)

  /*
   * Closing returns to wherever Settings was opened from, not to the dashboard.
   *
   * We close the drawer store synchronously so the overlay is dismissed, then navigate back to
   * the operator's last non-drawer location (or '/' if opened directly without prior history).
   */
  const close = () => {
    closeDrawerStore()
    const { returnPath } = useSettingsDrawerStore.getState()
    const target = returnPath && !isDrawerRoute(returnPath) ? returnPath : '/'
    navigate(target)
  }

  /*
   * A `page` section (Users) is a real page, not a drawer panel, so its tab navigates there and closes
   * the drawer explicitly — otherwise the drawer would stay open on its previous tab while the page
   * underneath changed.
   */
  const goToPage = (tab: SettingsTab) => {
    closeDrawerStore()
    navigate(`/settings/${tab}`)
  }

  const isAdministrator = Boolean(useAuthStore((s) => s.user)?.isAdministrator)
  const hasCapability = useAuthStore((s) => s.hasCapability)
  // Tabs are the sections this user may view, from the one registry the gear and the URL handler use.
  // Each panel still applies its own narrower checks (e.g. Checker Assignment needs Manage to edit).
  const sections = visibleSettingsSections((featureKey, capability = 'View') => isAdministrator || hasCapability(featureKey, capability))
  const activeSection = sections.find((s) => s.tab === activeTab && s.kind === 'drawer')
  const ActivePanel = activeSection ? SECTION_PANELS[activeSection.tab] : undefined

  // ESC key to close or pop layer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        if (layerStack.length > 1) {
          const current = layerStack[layerStack.length - 1]
          if (current.type === 'user-form') {
            close()
          } else {
            popLayer()
          }
        } else {
          close()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, layerStack, popLayer, close])

  if (!isOpen) return null

  const currentLayer = layerStack[layerStack.length - 1]
  const isOverrideLayer = layerStack.length > 1

  return (
    <div className={styles.overlayRoot}>
      {/* Backdrop */}
      <div className={styles.backdrop} onClick={close} />

      {/* Slide-over Drawer */}
      <div className={styles.drawerContainer} ref={drawerRef}>
        {isOverrideLayer ? (
          /* Override Layer (e.g. Edit Role, Add User, Add Application) */
          <div className={styles.overrideLayer}>
            {currentLayer.type === 'role-form' && (
              <RoleFormLayer roleId={currentLayer.roleId} initialTab={currentLayer.initialTab} />
            )}
            {currentLayer.type === 'user-form' && (
              <UserFormLayer userId={currentLayer.userId} />
            )}
            {currentLayer.type === 'app-form' && (
              <ApplicationFormLayer appId={currentLayer.appId} />
            )}
            {currentLayer.type === 'checker-assignment-form' && (
              <CheckerAssignmentFormLayer module={currentLayer.module} appId={currentLayer.appId} />
            )}
          </div>
        ) : (
          /* Root Settings Panel (Users / Roles / Applications) */
          <div className={styles.rootPanel}>
            {/* Header */}
            <div className={styles.header}>
              <div className={styles.headerLeft}>
                <div className={styles.headerIcon}>
                  <Icon.Settings width={20} height={20} />
                </div>
                <div>
                  <h2 className={styles.title}>System Settings</h2>
                  <p className={styles.subtitle}>Configure platform access, roles, and federated applications</p>
                </div>
              </div>
              <button
                type="button"
                className={styles.closeBtn}
                onClick={close}
                aria-label="Close Settings"
              >
                <Icon.X width={20} height={20} />
              </button>
            </div>

            {/* Horizontal Tabs */}
            <div className={styles.tabsNav} role="tablist" aria-label="Settings sections">
              {sections.map((section) => {
                const SectionIcon = Icon[section.icon]
                const selected = section.kind === 'drawer' && section.tab === activeTab
                return (
                  <button
                    key={section.tab}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    className={`${styles.tabBtn} ${selected ? styles.tabBtnActive : ''}`}
                    onClick={() => (section.kind === 'page' ? goToPage(section.tab) : goToTab(section.tab))}
                  >
                    <SectionIcon width={16} height={16} />
                    <span>{section.label}</span>
                  </button>
                )
              })}
            </div>

            {/* Tab Body */}
            <div className={styles.tabBody} role="tabpanel">
              {ActivePanel && <ActivePanel />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
