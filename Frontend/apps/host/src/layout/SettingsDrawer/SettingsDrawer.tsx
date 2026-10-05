import { useEffect, useRef, useState, type ComponentType } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, isSuperAdminOrAdmin } from '../../features/auth/store/authStore'
import { isDrawerRoute, useSettingsDrawerStore, type SettingsTab } from '../../shared/stores/settingsDrawerStore'
import { Icon } from '../../shared/components/Icon/Icon'
import { SettingsRolesTab } from './SettingsRolesTab'
import { SettingsApplicationsTab } from './SettingsApplicationsTab'
import { SettingsCheckerAssignmentTab } from './SettingsCheckerAssignmentTab'
import { RoleFormLayer } from './RoleFormLayer'
import { UserFormLayer } from './UserFormLayer'
import { ApplicationFormLayer } from './ApplicationFormLayer'
import { CheckerAssignmentFormLayer } from './CheckerAssignmentFormLayer'
import { visibleSettingsGroups, visibleSettingsSections } from '../../shared/settings/settingsSections'
import styles from './SettingsDrawer.module.css'

/** The panel each drawer section renders. */
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

  // On mobile (<768px), allows toggling between menu view and content view
  const [mobileContentView, setMobileContentView] = useState(false)

  const goToTab = (tab: SettingsTab) => {
    setMobileContentView(true)
    navigate(`/settings/${tab}`)
  }

  const close = () => {
    closeDrawerStore()
    const { returnPath } = useSettingsDrawerStore.getState()
    const target = returnPath && !isDrawerRoute(returnPath) ? returnPath : '/'
    navigate(target)
  }

  const goToPage = (routePath: string) => {
    closeDrawerStore()
    navigate(routePath)
  }

  const isAdministrator = useAuthStore((s) => isSuperAdminOrAdmin(s.user))
  const hasCapability = useAuthStore((s) => s.hasCapability)
  const can = (featureKey: string, capability = 'View') => isAdministrator || hasCapability(featureKey, capability)

  const groups = visibleSettingsGroups(can)
  const visibleSections = visibleSettingsSections(can)
  const activeSection = visibleSections.find((s) => s.tab === activeTab)
  const ActivePanel = activeSection && activeSection.kind === 'drawer' ? SECTION_PANELS[activeSection.tab] : undefined

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
          /* Root Settings Panel with Left Dark Navigation Menu matching screenshot */
          <div className={styles.rootPanel}>
            {/* Left Menu Pane */}
            <aside
              className={`${styles.menuPane} ${mobileContentView && ActivePanel ? styles.menuPaneHidden : ''}`}
              aria-label="Settings navigation"
            >
              <div className={styles.menuHeader}>
                <h2 className={styles.title}>Settings</h2>
                <button
                  type="button"
                  className={styles.closeBtn}
                  onClick={close}
                  aria-label="Close Settings"
                >
                  <Icon.X width={17} height={17} />
                </button>
              </div>

              <nav className={styles.menuNav}>
                {groups.map((group) => (
                  <div key={group.category} className={styles.categoryBlock}>
                    <div className={styles.categoryHeader}>{group.category}</div>
                    {group.items.map((item) => {
                      const isSelected = item.kind === 'drawer' && item.tab === activeTab
                      return (
                        <button
                          key={item.tab}
                          type="button"
                          className={`${styles.navItem} ${isSelected ? styles.navItemActive : ''}`}
                          onClick={() =>
                            item.kind === 'page' ? goToPage(item.routePath) : goToTab(item.tab)
                          }
                        >
                          {item.label}
                        </button>
                      )
                    })}
                  </div>
                ))}
              </nav>
            </aside>

            {/* Right Content Pane for Drawer-hosted tabs (Roles, Applications, Checker Assignment) */}
            <main
              className={`${styles.contentPane} ${!mobileContentView && ActivePanel ? '' : !ActivePanel ? styles.contentPaneHidden : ''}`}
              role="tabpanel"
            >
              <div className={styles.contentHeader}>
                <button
                  type="button"
                  className={styles.mobileBackBtn}
                  onClick={() => setMobileContentView(false)}
                >
                  <Icon.ChevronLeft width={16} height={16} />
                  <span>Settings Menu</span>
                </button>
                <h3 className={styles.contentTitle}>{activeSection?.label ?? 'Settings'}</h3>
                <button
                  type="button"
                  className={styles.closeBtn}
                  onClick={close}
                  aria-label="Close"
                  style={{ color: '#64748b' }}
                >
                  <Icon.X width={18} height={18} />
                </button>
              </div>

              <div className={styles.contentBody}>
                {ActivePanel && <ActivePanel />}
              </div>
            </main>
          </div>
        )}
      </div>
    </div>
  )
}
