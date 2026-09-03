import { useCallback, useEffect, useState, useMemo, useRef, type FormEvent } from 'react'
import { useAuthStore } from '../../features/auth/store/authStore'
import { usersApi } from '../../features/settings-users/api/usersApi'
import { rolesApi } from '../../features/settings-roles/api/rolesApi'
import { checkerAssignmentsApi, type AssignableModuleDto } from '../../features/approvals/api/checkerAssignmentsApi'
import { useSettingsDrawerStore } from '../../shared/stores/settingsDrawerStore'
import { useClickOutside } from '../../shared/hooks/useClickOutside'
import { Icon } from '../../shared/components/Icon/Icon'
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
  /** Pre-selected module, when opened via a specific module card's "Add Checker" button. */
  module?: string
}
/**
 * Assigns one checker to one module. Deliberately a single simple form, not a wizard — there's only
 * two fields — but follows the same header/popLayer/invalidate shape every other form layer here
 * uses (UserFormLayer, RoleFormLayer, ApplicationFormLayer) so it reads as the same system.
 */
export function CheckerAssignmentFormLayer({ module: initialModule }: CheckerAssignmentFormLayerProps) {
  const accessToken = useAuthStore((s) => s.accessToken)
  const popLayer = useSettingsDrawerStore((s) => s.popLayer)
  const [module, setModule] = useState(initialModule ?? '')
  const [modules, setModules] = useState<AssignableModuleDto[]>([])
  const [moduleDropdownOpen, setModuleDropdownOpen] = useState(false)
  const [moduleSearch, setModuleSearch] = useState('')

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

    return () => {
      cancelled = true
    }
  }, [accessToken])

  const selectedModule = useMemo(() => modules.find((m) => m.key === module), [modules, module])

  // The module list stays client-filtered on purpose: it is the live PermissionFeature catalog, which
  // is inherently small and bounded by how many modules the platform has — not by how much data users
  // have entered. There is no server-side search endpoint for it, and it needs none.
  const filteredModules = useMemo(() => {
    if (!moduleSearch.trim()) return modules
    const q = moduleSearch.toLowerCase().trim()
    return modules.filter((m) => m.label.toLowerCase().includes(q) || m.key.toLowerCase().includes(q))
  }, [modules, moduleSearch])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    const targetId = targetKind === 'user' ? checkerUserId : checkerRoleId
    if (!accessToken || !targetId) return
    setSaving(true)
    setError(null)
    try {
      const result = await checkerAssignmentsApi.upsert(
        accessToken,
        targetKind === 'user' ? { module, checkerUserId } : { module, checkerRoleId },
      )
      // The server reports an idempotent no-op distinctly, so a second attempt says so rather than
      // implying something changed.
      if (result.alreadyAssigned) {
        toast.success(`${result.checkerName} is already a checker for '${module}'.`)
      } else {
        toast.success(
          result.isRole
            ? `Anyone with the '${result.checkerName}' role (${result.memberCount ?? 0} active) is now a checker for '${module}'.`
            : `${result.checkerName} is now a checker for '${module}'.`,
        )
      }
      invalidate(TOPICS.checkerAssignments)
      popLayer()
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
            <p className={styles.subtitle}>Map a module to an eligible approver</p>
          </div>
        </div>
        <button type="button" className={styles.closeBtn} onClick={popLayer} aria-label="Close">
          <Icon.X width={16} height={16} />
        </button>
      </div>

      {error && <div className={styles.errorAlert}>{error}</div>}

      <form id="checker-assignment-form" onSubmit={handleSubmit} className={styles.form}>
        <div className={styles.contentArea}>
          <div className={styles.formCard}>
            <h4 className={styles.formCardTitle}>Assignment Configuration</h4>

            {/* Target Module Dropdown */}
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
                      <>
                        <span className={styles.triggerModuleName}>{selectedModule.label}</span>
                        <span className={styles.triggerModuleKey}>{selectedModule.key}</span>
                      </>
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
                                <span className={styles.triggerModuleKey}>{m.key}</span>
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
          <button type="button" className={styles.cancelBtn} onClick={popLayer}>
            Cancel
          </button>
          <button type="submit" className={styles.saveBtn} disabled={saving || !(targetKind === 'user' ? checkerUserId : checkerRoleId)}>
            {saving ? (
              <span>Saving...</span>
            ) : (
              <>
                <Icon.CheckCircle width={14} height={14} />
                <span>Assign Checker</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}

