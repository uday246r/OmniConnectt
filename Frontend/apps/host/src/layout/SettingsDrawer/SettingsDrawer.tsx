import { useEffect, useRef } from 'react'
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
import styles from './SettingsDrawer.module.css'

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
   * The URL is the source of truth for which tab is open — SettingsRoute in App.tsx reacts to it.
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
   * Users left the drawer for a real page (UsersPage), so its tab button is a plain navigation +
   * close instead of goToTab — /settings/users renders UsersPage directly now, not the drawer's own
   * Users panel, so nothing here should open the drawer for it. Closing explicitly (rather than
   * relying on SettingsRoute to do it) matters when this is clicked while the drawer is already open
   * on another tab: without it, the drawer would stay open showing its previous tab while the page
   * underneath silently changed.
   */
  const goToUsersPage = () => {
    closeDrawerStore()
    navigate('/settings/users')
  }

  const isAdministrator = Boolean(useAuthStore((s) => s.user)?.isAdministrator)
  const hasCapability = useAuthStore((s) => s.hasCapability)
  // Deliberately its own, narrower gate than Users/Roles/Applications' own View capability — only
  // someone who can at least VIEW who's assigned as a checker sees this tab at all; Manage (a
  // separate, further-narrowed capability) is what actually lets them add/remove assignments, see
  // SettingsCheckerAssignmentTab's own canManage check.
  const canAccessUsers = isAdministrator || hasCapability('host.settings.users', 'View')
const canAccessRoles = isAdministrator || hasCapability('host.settings.roles', 'View')
const canAccessApplications = isAdministrator || hasCapability('host.settings.applications', 'View')
  const canAccessCheckerAssignment = isAdministrator || hasCapability('host.system.checker-assignment', 'View')

  // ESC key to close or pop layer
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && isOpen) {
        if (layerStack.length > 1) {
          popLayer()
        } else {
          close()
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, layerStack.length, popLayer, close])

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
            <div className={styles.tabsNav}>
              {canAccessUsers && (
                <button
                type="button"
                className={styles.tabBtn}
                onClick={goToUsersPage}
              >
                <Icon.Users width={16} height={16} />
                <span>Users</span>
              </button>
              )}

              {canAccessRoles && (
              <button
                type="button"
                className={`${styles.tabBtn} ${activeTab === 'roles' ? styles.tabBtnActive : ''}`}
                onClick={() => goToTab('roles')}
              >
                <Icon.ShieldCheck width={16} height={16} />
                <span>Roles</span>
              </button>
              )}

              {canAccessApplications && (
              <button
                type="button"
                className={`${styles.tabBtn} ${activeTab === 'applications' ? styles.tabBtnActive : ''}`}
                onClick={() => goToTab('applications')}
              >
                <Icon.Grid width={16} height={16} />
                <span>Applications</span>
              </button>
              )}
              
              {canAccessCheckerAssignment && (
                <button
                  type="button"
                  className={`${styles.tabBtn} ${activeTab === 'checker-assignment' ? styles.tabBtnActive : ''}`}
                  onClick={() => goToTab('checker-assignment')}
                >
                  <Icon.UserCheck width={16} height={16} />
                  <span>Checker Assignment</span>
                </button>
              )}
            </div>

            {/* Tab Body */}
            <div className={styles.tabBody}>
              {activeTab === 'roles' && <SettingsRolesTab />}
              {activeTab === 'applications' && <SettingsApplicationsTab />}
              {activeTab === 'checker-assignment' && canAccessCheckerAssignment && <SettingsCheckerAssignmentTab />}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
