import { useCallback, useEffect, useState, useMemo, useRef, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../features/auth/store/authStore'
import { usersApi } from '../../features/settings-users/api/usersApi'
import { rolesApi } from '../../features/settings-roles/api/rolesApi'
import { checkerAssignmentsApi, type AssignableModuleDto } from '../../features/approvals/api/checkerAssignmentsApi'
import { remoteAppsApi, type RemoteAppDto } from '../../features/settings-applications/api/remoteAppsApi'
import { groupModulesByApp } from '../../features/approvals/utils/moduleAppGrouping'
import { useSettingsDrawerStore } from '../../shared/stores/settingsDrawerStore'
import { useClickOutside } from '../../shared/hooks/useClickOutside'
import { Icon } from '../../shared/components/Icon/Icon'
import { resolveIcon } from '../../shared/components/Icon/resolveIcon'
import {
  AsyncSearchSelect,
  type AsyncSearchOption,
  type AsyncSearchResult,
} from '../../shared/components/AsyncSearchSelect'
import { ApiError } from '../../shared/api/httpClient'
import { toast } from '../../shared/stores/toastStore'
import styles from './CheckerAssignmentFormLayer.module.css'
import { TOPICS, invalidate } from '../../shared/stores/invalidationStore'

interface CheckerAssignmentFormLayerProps {
  /** Pre-selected module, when opened via a specific module card's "Add" button. */
  module?: string
  /** Pre-selected application, when opened via an app section's "Assign to Whole App" button —
   *  opens straight into the bulk "entire application" scope instead of the single-module one. */
  appId?: string
}
/**
 * Assigns one checker either to a single module, or in bulk to every module belonging to one
 * application — "assign one checker for a whole remote app at once" instead of repeating this form
 * once per module. Follows the same header/popLayer/invalidate shape every other form layer here uses
 * (UserFormLayer, RoleFormLayer, ApplicationFormLayer) so it reads as the same system.
 */
export function CheckerAssignmentFormLayer({ module: initialModule, appId: initialAppId }: CheckerAssignmentFormLayerProps) {
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.accessToken)
  // A token refresh must not re-run a load (and reset what the user is editing) — only its first arrival.
  const hasAccessToken = Boolean(accessToken)

  const finish = () => {
    const { returnPath, close } = useSettingsDrawerStore.getState()
    close()
    navigate(returnPath.startsWith('/settings/checker-assignment') ? returnPath : '/settings/checker-assignment')
  }

  // Scope: one module, or every module in one application at once. Opening from an app's "Assign to
  // Whole App" button starts in 'app' scope with that app pre-picked; every other entry point starts
  // in the single-module scope, as before.
  const [scope, setScope] = useState<'module' | 'app'>(initialAppId ? 'app' : 'module')
  const [module, setModule] = useState(initialModule ?? '')
  const [modules, setModules] = useState<AssignableModuleDto[]>([])
  const [moduleDropdownOpen, setModuleDropdownOpen] = useState(false)
  const [moduleSearch, setModuleSearch] = useState('')

  const [remoteApps, setRemoteApps] = useState<RemoteAppDto[]>([])
  const [selectedAppId, setSelectedAppId] = useState(initialAppId ?? '')
  const [appDropdownOpen, setAppDropdownOpen] = useState(false)
  const [appSearch, setAppSearch] = useState('')

  /*
   * An assignment names a user OR a role. A role is usually the better choice — "any Manager can
   * approve" survives people joining and leaving, whereas a named individual has to be remembered
   * and updated. Membership is re-resolved on every routing decision, never frozen at assignment.
   */
  const [targetKind, setTargetKind] = useState<'user' | 'role'>('user')
  const [checkerUserId, setCheckerUserId] = useState('')
  const [checkerRoleId, setCheckerRoleId] = useState('')
  /*
   * Only the SELECTED user/role is held here, not a list.
   *
   * Both pickers used to fetch a page of records and filter it in the browser. Because the list
   * endpoints clamp pageSize to 100, every record past the hundredth was unreachable — the search box
   * looked like it worked while searching a fraction of the data. The options now come from the
   * server per keystroke; the only thing that must be remembered locally is the current choice, so it
   * still renders when it falls outside the latest result window.
   */
  const [selectedUser, setSelectedUser] = useState<AsyncSearchOption | null>(null)
  const [selectedRole, setSelectedRole] = useState<AsyncSearchOption | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const moduleDropdownRef = useRef<HTMLDivElement>(null)
  useClickOutside([moduleDropdownRef], () => setModuleDropdownOpen(false), moduleDropdownOpen)

  const appDropdownRef = useRef<HTMLDivElement>(null)
  useClickOutside([appDropdownRef], () => setAppDropdownOpen(false), appDropdownOpen)

  const searchUsers = useCallback(
    async (term: string): Promise<AsyncSearchResult> => {
      if (!accessToken) return { options: [] }
      const res = await usersApi.list(accessToken, { pageSize: 25, isActive: true, search: term || undefined })
      return {
        options: res.items.map((u) => ({ id: u.id, label: u.name || u.email, sublabel: u.email })),
        total: res.total,
      }
    },
    [accessToken],
  )

  const searchRoles = useCallback(
    async (term: string): Promise<AsyncSearchResult> => {
      if (!accessToken) return { options: [] }
      const res = await rolesApi.list(accessToken, { pageSize: 25, search: term || undefined })
      return {
        options: res.items.map((r) => ({ id: r.id, label: r.name, sublabel: r.description ?? undefined })),
        total: res.total,
      }
    },
    [accessToken],
  )

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false

    checkerAssignmentsApi
      .listModules(accessToken)
      .then((res) => {
        if (cancelled) return
        setModules(res)
        setModule((current) => current || res[0]?.key || '')
      })
      .catch((err) => {
        if (!cancelled) console.error('Failed to load assignable modules:', err)
      })

    remoteAppsApi
      .list(accessToken, { pageSize: 100 })
      .then((res) => {
        if (!cancelled) setRemoteApps(res.items)
      })
      .catch((err) => {
        if (!cancelled) console.error('Failed to load applications for the bulk checker picker:', err)
      })

    return () => {
      cancelled = true
    }
  }, [hasAccessToken])

  const selectedModule = useMemo(() => modules.find((m) => m.key === module), [modules, module])

  // The module list stays client-filtered on purpose: it is the live PermissionFeature catalog, which
  // is inherently small and bounded by how many modules the platform has — not by how much data users
  // have entered. There is no server-side search endpoint for it, and it needs none.
  const filteredModules = useMemo(() => {
    if (!moduleSearch.trim()) return modules
    const q = moduleSearch.toLowerCase().trim()
    return modules.filter((m) => m.label.toLowerCase().includes(q) || m.key.toLowerCase().includes(q))
  }, [modules, moduleSearch])

  // Application groups for the bulk scope — same grouping the Checker Assignment list uses, so
  // "Entire Application" here means exactly the same set of modules as that app's section there.
  const appGroups = useMemo(() => groupModulesByApp(modules, remoteApps), [modules, remoteApps])
  const appGroupsWithModules = useMemo(() => appGroups.filter((g) => g.modules.length > 0), [appGroups])

  const selectedAppGroup = useMemo(
    () => appGroupsWithModules.find((g) => g.id === selectedAppId),
    [appGroupsWithModules, selectedAppId],
  )

  const filteredAppGroups = useMemo(() => {
    if (!appSearch.trim()) return appGroupsWithModules
    const q = appSearch.toLowerCase().trim()
    return appGroupsWithModules.filter((g) => g.name.toLowerCase().includes(q))
  }, [appGroupsWithModules, appSearch])

  // The module keys this submission will actually touch — one, or every module in the picked app.
  const targetModuleKeys = useMemo(() => {
    if (scope === 'app') return selectedAppGroup?.modules.map((m) => m.key) ?? []
    return module ? [module] : []
  }, [scope, selectedAppGroup, module])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const targetId = targetKind === 'user' ? checkerUserId : checkerRoleId
    if (!accessToken || !targetId) return
    if (scope === 'module' && !module) return
    if (scope === 'app' && targetModuleKeys.length === 0) return

    setSaving(true)
    setError(null)
    try {
      if (scope === 'app') {
        const results = await checkerAssignmentsApi.bulkUpsert(
          accessToken,
          targetKind === 'user'
            ? { modules: targetModuleKeys, checkerUserId }
            : { modules: targetModuleKeys, checkerRoleId },
        )
        const checkerName = results[0]?.checkerName ?? ''
        const appName = selectedAppGroup?.name ?? 'this application'
        const count = targetModuleKeys.length
        toast.success(
          results[0]?.isRole
            ? `Anyone with the '${checkerName}' role (${results[0]?.memberCount ?? 0} active) is now a checker for all ${count} module${count === 1 ? '' : 's'} in '${appName}'.`
            : `${checkerName} is now a checker for all ${count} module${count === 1 ? '' : 's'} in '${appName}'.`,
        )
      } else {
        const result = await checkerAssignmentsApi.upsert(
          accessToken,
          targetKind === 'user' ? { module, checkerUserId } : { module, checkerRoleId },
        )
        const moduleLabel = selectedModule?.label ?? module
        // The server reports an idempotent no-op distinctly, so a second attempt says so rather than
        // implying something changed.
        if (result.alreadyAssigned) {
          toast.success(`${result.checkerName} is already a checker for '${moduleLabel}'.`)
        } else {
          toast.success(
            result.isRole
              ? `Anyone with the '${result.checkerName}' role (${result.memberCount ?? 0} active) is now a checker for '${moduleLabel}'.`
              : `${result.checkerName} is now a checker for '${moduleLabel}'.`,
          )
        }
      }
      invalidate(TOPICS.checkerAssignments)
      finish()
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not assign this checker.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.layer}>
      <div className={styles.header}>
        <div className={styles.headerTitleWrap}>
          <div className={styles.headerIconBox}>
            <Icon.UserCheck width={17} height={17} />
          </div>
          <div>
            <h2 className={styles.title}>Assign Checker</h2>
            <p className={styles.subtitle}>Map a module — or a whole application — to an eligible approver</p>
          </div>
        </div>
        <button type="button" className={styles.closeBtn} onClick={finish} aria-label="Close">
          <Icon.X width={16} height={16} />
        </button>
      </div>

      {error && <div className={styles.errorAlert}>{error}</div>}

      <form id="checker-assignment-form" onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.contentArea}>
          <div className={styles.formCard}>
            <h4 className={styles.formCardTitle}>Assignment Configuration</h4>

            {/*
              Scope: one module, or every module belonging to one application at once. Bulk-picking
              an app is the "assign one checker for a whole remote app in one go" path — it resolves
              to the same module list the Checker Assignment list groups under that app's section, so
              the two never disagree about which modules "the app" means.
            */}
            <div className={styles.inputGroup}>
              <label className={styles.label}>
                <span>Assignment Scope <span className={styles.req}>*</span></span>
              </label>
              <div className={styles.kindToggle} role="radiogroup" aria-label="Assignment scope">
                <button
                  type="button"
                  role="radio"
                  aria-checked={scope === 'module'}
                  className={scope === 'module' ? styles.kindOptionActive : styles.kindOption}
                  onClick={() => setScope('module')}
                >
                  <Icon.Layers width={15} height={15} />
                  <span>Single module</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={scope === 'app'}
                  className={scope === 'app' ? styles.kindOptionActive : styles.kindOption}
                  onClick={() => setScope('app')}
                >
                  <Icon.Box width={15} height={15} />
                  <span>Entire application</span>
                </button>
              </div>
            </div>

            {/* Target Module Dropdown */}
            {scope === 'module' && (
              <div className={styles.inputGroup}>
                <label className={styles.label}>
                  <span>Target Module <span className={styles.req}>*</span></span>
                </label>

                <div className={styles.dropdownWrap} ref={moduleDropdownRef}>
                  <button
                    type="button"
                    className={`${styles.dropdownTrigger} ${moduleDropdownOpen ? styles.dropdownTriggerOpen : ''}`}
                    onClick={() => {
                      setModuleDropdownOpen(!moduleDropdownOpen)
                      if (!moduleDropdownOpen) setModuleSearch('')
                    }}
                    aria-haspopup="listbox"
                    aria-expanded={moduleDropdownOpen}
                  >
                    <div className={styles.triggerLeft}>
                      {selectedModule ? (
                        <span className={styles.triggerModuleName}>{selectedModule.label}</span>
                      ) : (
                        <span className={styles.triggerPlaceholder}>-- Select a module --</span>
                      )}
                    </div>
                    <Icon.ChevronDown
                      width={13}
                      height={13}
                      className={`${styles.triggerChevron} ${moduleDropdownOpen ? styles.triggerChevronOpen : ''}`}
                    />
                  </button>

                  {moduleDropdownOpen && (
                    <div className={styles.dropdownMenu} role="listbox">
                      <div className={styles.dropdownSearchWrap}>
                        <input
                          type="text"
                          className={styles.dropdownSearchInput}
                          placeholder="Type to search module..."
                          value={moduleSearch}
                          onChange={(e) => setModuleSearch(e.target.value)}
                          autoFocus
                        />
                        <Icon.Search width={12} height={12} className={styles.dropdownSearchIcon} />
                      </div>

                      <div className={styles.dropdownList}>
                        {filteredModules.length === 0 ? (
                          <div className={styles.dropdownEmpty}>No modules match &quot;{moduleSearch}&quot;</div>
                        ) : (
                          filteredModules.map((m) => {
                            const isSelected = m.key === module
                            return (
                              <div
                                key={m.key}
                                className={`${styles.dropdownItem} ${isSelected ? styles.dropdownItemSelected : ''}`}
                                role="option"
                                aria-selected={isSelected}
                                onClick={() => {
                                  setModule(m.key)
                                  setModuleDropdownOpen(false)
                                  setModuleSearch('')
                                }}
                              >
                                <div className={styles.dropdownItemLeft}>
                                  <span className={styles.dropdownName}>{m.label}</span>
                                </div>
                                {isSelected && (
                                  <Icon.CheckCircle width={14} height={14} className={styles.dropdownCheckIcon} />
                                )}
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Target Application Dropdown (bulk scope) */}
            {scope === 'app' && (
              <div className={styles.inputGroup}>
                <label className={styles.label}>
                  <span>Target Application <span className={styles.req}>*</span></span>
                </label>

                <div className={styles.dropdownWrap} ref={appDropdownRef}>
                  <button
                    type="button"
                    className={`${styles.dropdownTrigger} ${appDropdownOpen ? styles.dropdownTriggerOpen : ''}`}
                    onClick={() => {
                      setAppDropdownOpen(!appDropdownOpen)
                      if (!appDropdownOpen) setAppSearch('')
                    }}
                    aria-haspopup="listbox"
                    aria-expanded={appDropdownOpen}
                  >
                    <div className={styles.triggerLeft}>
                      {selectedAppGroup ? (
                        <span className={styles.triggerModuleName}>{selectedAppGroup.name}</span>
                      ) : (
                        <span className={styles.triggerPlaceholder}>-- Select an application --</span>
                      )}
                    </div>
                    <Icon.ChevronDown
                      width={13}
                      height={13}
                      className={`${styles.triggerChevron} ${appDropdownOpen ? styles.triggerChevronOpen : ''}`}
                    />
                  </button>

                  {appDropdownOpen && (
                    <div className={styles.dropdownMenu} role="listbox">
                      <div className={styles.dropdownSearchWrap}>
                        <input
                          type="text"
                          className={styles.dropdownSearchInput}
                          placeholder="Type to search application..."
                          value={appSearch}
                          onChange={(e) => setAppSearch(e.target.value)}
                          autoFocus
                        />
                        <Icon.Search width={12} height={12} className={styles.dropdownSearchIcon} />
                      </div>

                      <div className={styles.dropdownList}>
                        {filteredAppGroups.length === 0 ? (
                          <div className={styles.dropdownEmpty}>No applications match &quot;{appSearch}&quot;</div>
                        ) : (
                          filteredAppGroups.map((g) => {
                            const isSelected = g.id === selectedAppId
                            const AppIcon = resolveIcon(g.iconKey, g.isHost ? Icon.Shield : Icon.Box)
                            return (
                              <div
                                key={g.id}
                                className={`${styles.dropdownItem} ${isSelected ? styles.dropdownItemSelected : ''}`}
                                role="option"
                                aria-selected={isSelected}
                                onClick={() => {
                                  setSelectedAppId(g.id)
                                  setAppDropdownOpen(false)
                                  setAppSearch('')
                                }}
                              >
                                <div className={styles.dropdownItemLeft}>
                                  <div className={styles.dropdownAvatar}>
                                    <AppIcon width={13} height={13} />
                                  </div>
                                  <span className={styles.dropdownName}>{g.name}</span>
                                </div>
                                {isSelected && (
                                  <Icon.CheckCircle width={14} height={14} className={styles.dropdownCheckIcon} />
                                )}
                              </div>
                            )
                          })
                        )}
                      </div>
                    </div>
                  )}
                </div>

                {selectedAppGroup && (
                  <p className={styles.hint}>
                    Assigns this checker to all {selectedAppGroup.modules.length} module
                    {selectedAppGroup.modules.length === 1 ? '' : 's'} in &lsquo;{selectedAppGroup.name}&rsquo; —
                    including ones already gated by another checker.
                  </p>
                )}
              </div>
            )}

            {/*
              Who approves: one named person, or anyone holding a role.

              A role is usually the better answer. It survives staff changes — a new Manager can act
              the day they get the role, a departing one stops being eligible the moment it is taken
              away — and it removes the single-checker deadlock where the only assigned approver is
              also the person making the request. Membership is resolved at routing time, never
              frozen when the assignment is saved.
            */}
            <div className={styles.inputGroup}>
              <label className={styles.label}>
                <span>Checker Type <span className={styles.req}>*</span></span>
              </label>
              <div className={styles.kindToggle} role="radiogroup" aria-label="Checker type">
                <button
                  type="button"
                  role="radio"
                  aria-checked={targetKind === 'user'}
                  className={targetKind === 'user' ? styles.kindOptionActive : styles.kindOption}
                  onClick={() => setTargetKind('user')}
                >
                  <Icon.User width={15} height={15} />
                  <span>A specific user</span>
                </button>
                <button
                  type="button"
                  role="radio"
                  aria-checked={targetKind === 'role'}
                  className={targetKind === 'role' ? styles.kindOptionActive : styles.kindOption}
                  onClick={() => setTargetKind('role')}
                >
                  <Icon.ShieldCheck width={15} height={15} />
                  <span>Anyone with a role</span>
                </button>
              </div>
            </div>

            {targetKind === 'role' && (
              <div className={styles.inputGroup}>
                <label className={styles.label}>
                  <span>Select Checker Role <span className={styles.req}>*</span></span>
                </label>
                <AsyncSearchSelect
                  value={checkerRoleId || null}
                  selected={selectedRole}
                  onChange={(id, option) => {
                    setCheckerRoleId(id ?? '')
                    setSelectedRole(option)
                  }}
                  onSearch={searchRoles}
                  placeholder="-- Select a role --"
                  searchPlaceholder="Type a role name to search..."
                  emptyMessage="No roles found"
                  required
                />
                <p className={styles.hint}>
                  Every active member of this role can approve requests for this module. A request is
                  never routed to its own maker, even if they hold the role.
                </p>
              </div>
            )}

            {targetKind === 'user' && (
              <div className={styles.inputGroup}>
                <label className={styles.label}>
                  <span>Select Checker User <span className={styles.req}>*</span></span>
                </label>
                <AsyncSearchSelect
                  value={checkerUserId || null}
                  selected={selectedUser}
                  onChange={(id, option) => {
                    setCheckerUserId(id ?? '')
                    setSelectedUser(option)
                  }}
                  onSearch={searchUsers}
                  placeholder="-- Select an approver checker --"
                  searchPlaceholder="Type user name or email to search..."
                  emptyMessage="No active users found"
                  showAvatar
                  required
                />
              </div>
            )}
          </div>
        </div>

        <div className={styles.bottomBar}>
          <button type="button" className={styles.cancelBtn} onClick={finish}>
            Cancel
          </button>
          <button
            type="submit"
            className={styles.saveBtn}
            disabled={saving || !(targetKind === 'user' ? checkerUserId : checkerRoleId) || targetModuleKeys.length === 0}
          >
            {saving ? (
              <span>Saving...</span>
            ) : (
              <>
                <Icon.CheckCircle width={14} height={14} />
                <span>{scope === 'app' && targetModuleKeys.length > 1 ? `Assign to ${targetModuleKeys.length} Modules` : 'Assign Checker'}</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}

