import { useEffect, useState, useMemo, useRef, type FormEvent } from 'react'
import { useAuthStore } from '../../features/auth/store/authStore'
import { usersApi, type UserListItemDto } from '../../features/settings-users/api/usersApi'
import { checkerAssignmentsApi, type AssignableModuleDto } from '../../features/approvals/api/checkerAssignmentsApi'
import { useSettingsDrawerStore } from '../../shared/stores/settingsDrawerStore'
import { useClickOutside } from '../../shared/hooks/useClickOutside'
import { Icon } from '../../shared/components/Icon/Icon'
import { ApiError } from '../../shared/api/httpClient'
import { toast } from '../../shared/stores/toastStore'
import styles from './CheckerAssignmentFormLayer.module.css'
import { TOPICS, invalidate } from '../../shared/stores/invalidationStore'

interface CheckerAssignmentFormLayerProps {
  /** Pre-selected module, when opened via a specific module card's "Add Checker" button. */
  module?: string
}

function getInitials(name?: string, email?: string): string {
  if (name && name.trim()) {
    const parts = name.trim().split(/\s+/)
    if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
    return name.substring(0, 2).toUpperCase()
  }
  if (email) return email.substring(0, 2).toUpperCase()
  return 'U'
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

  const [checkerUserId, setCheckerUserId] = useState('')
  const [userDropdownOpen, setUserDropdownOpen] = useState(false)
  const [userSearch, setUserSearch] = useState('')
  const [users, setUsers] = useState<UserListItemDto[]>([])
  const [loadingUsers, setLoadingUsers] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const moduleDropdownRef = useRef<HTMLDivElement>(null)
  useClickOutside([moduleDropdownRef], () => setModuleDropdownOpen(false), moduleDropdownOpen)

  const userDropdownRef = useRef<HTMLDivElement>(null)
  useClickOutside([userDropdownRef], () => setUserDropdownOpen(false), userDropdownOpen)

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false

    async function loadUsers() {
      try {
        const res = await usersApi.list(accessToken!, { pageSize: 100, isActive: true })
        if (!cancelled) setUsers(res.items.sort((a, b) => (a.name || a.email).localeCompare(b.name || b.email)))
      } catch (err) {
        console.error('Failed to load users for checker picker:', err)
      } finally {
        if (!cancelled) setLoadingUsers(false)
      }
    }

    void loadUsers()
    return () => {
      cancelled = true
    }
  }, [accessToken])

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
  const selectedUser = useMemo(() => users.find((u) => u.id === checkerUserId), [users, checkerUserId])

  const filteredModules = useMemo(() => {
    if (!moduleSearch.trim()) return modules
    const q = moduleSearch.toLowerCase().trim()
    return modules.filter((m) => m.label.toLowerCase().includes(q) || m.key.toLowerCase().includes(q))
  }, [modules, moduleSearch])

  const filteredUsers = useMemo(() => {
    if (!userSearch.trim()) return users
    const q = userSearch.toLowerCase().trim()
    return users.filter(
      (u) =>
        (u.name && u.name.toLowerCase().includes(q)) ||
        (u.email && u.email.toLowerCase().includes(q)),
    )
  }, [users, userSearch])

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!accessToken || !checkerUserId) return
    setSaving(true)
    setError(null)
    try {
      const result = await checkerAssignmentsApi.upsert(accessToken, { module, checkerUserId })
      toast.success(`${result.checkerName} is now a checker for '${module}'.`)
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
                    setUserDropdownOpen(false)
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

            {/* Checker User Dropdown */}
            <div className={styles.inputGroup}>
              <label className={styles.label}>
                <span>Select Checker User <span className={styles.req}>*</span></span>
              </label>

              <div className={styles.dropdownWrap} ref={userDropdownRef}>
                <button
                  type="button"
                  className={`${styles.dropdownTrigger} ${userDropdownOpen ? styles.dropdownTriggerOpen : ''}`}
                  onClick={() => {
                    setUserDropdownOpen(!userDropdownOpen)
                    setModuleDropdownOpen(false)
                    if (!userDropdownOpen) setUserSearch('')
                  }}
                  aria-haspopup="listbox"
                  aria-expanded={userDropdownOpen}
                  disabled={loadingUsers}
                >
                  <div className={styles.triggerLeft}>
                    {selectedUser ? (
                      <>
                        <div className={styles.triggerAvatar}>
                          {getInitials(selectedUser.name, selectedUser.email)}
                        </div>
                        <span className={styles.triggerUserName}>{selectedUser.name || 'Unnamed User'}</span>
                        <span className={styles.triggerUserEmail}>({selectedUser.email})</span>
                      </>
                    ) : (
                      <span className={styles.triggerPlaceholder}>
                        {loadingUsers ? 'Loading users list…' : '-- Select an approver checker --'}
                      </span>
                    )}
                  </div>
                  <Icon.ChevronDown
                    width={13}
                    height={13}
                    className={`${styles.triggerChevron} ${userDropdownOpen ? styles.triggerChevronOpen : ''}`}
                  />
                </button>

                {userDropdownOpen && (
                  <div className={styles.dropdownMenu} role="listbox">
                    <div className={styles.dropdownSearchWrap}>
                      <input
                        type="text"
                        className={styles.dropdownSearchInput}
                        placeholder="Type user name or email to search..."
                        value={userSearch}
                        onChange={(e) => setUserSearch(e.target.value)}
                        autoFocus
                      />
                      <Icon.Search width={12} height={12} className={styles.dropdownSearchIcon} />
                    </div>

                    <div className={styles.dropdownList}>
                      {loadingUsers ? (
                        <div className={styles.dropdownEmpty}>Loading active users list…</div>
                      ) : filteredUsers.length === 0 ? (
                        <div className={styles.dropdownEmpty}>
                          No active users found matching &quot;{userSearch}&quot;
                        </div>
                      ) : (
                        filteredUsers.map((u) => {
                          const isSelected = checkerUserId === u.id
                          return (
                            <div
                              key={u.id}
                              className={`${styles.dropdownItem} ${isSelected ? styles.dropdownItemSelected : ''}`}
                              role="option"
                              aria-selected={isSelected}
                              onClick={() => {
                                setCheckerUserId(u.id)
                                setUserDropdownOpen(false)
                                setUserSearch('')
                              }}
                            >
                              <div className={styles.dropdownItemLeft}>
                                <div className={styles.dropdownAvatar}>
                                  {getInitials(u.name, u.email)}
                                </div>
                                <div className={styles.dropdownInfo}>
                                  <span className={styles.dropdownName}>{u.name || 'Unnamed User'}</span>
                                  <span className={styles.dropdownEmail}>{u.email}</span>
                                </div>
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
          </div>
        </div>

        <div className={styles.bottomBar}>
          <button type="button" className={styles.cancelBtn} onClick={popLayer}>
            Cancel
          </button>
          <button type="submit" className={styles.saveBtn} disabled={saving || !checkerUserId}>
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

