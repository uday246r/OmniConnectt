import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuthStore } from '../../features/auth/store/authStore'
import { checkerAssignmentsApi, type AssignableModuleDto, type CheckerAssignmentDto } from '../../features/approvals/api/checkerAssignmentsApi'
import { remoteAppsApi, type RemoteAppDto } from '../../features/settings-applications/api/remoteAppsApi'
import { useSettingsDrawerStore } from '../../shared/stores/settingsDrawerStore'
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue'
import { useClickOutside } from '../../shared/hooks/useClickOutside'
import { Icon } from '../../shared/components/Icon/Icon'
import { resolveIcon } from '../../shared/components/Icon/resolveIcon'
import { SkeletonBlock } from '../../shared/components/Skeleton'
import { Modal } from '../../shared/components/Modal/Modal'
import { Button } from '../../shared/components/Button/Button'
import { ApiError } from '../../shared/api/httpClient'
import { toast } from '../../shared/stores/toastStore'
import styles from './SettingsCheckerAssignmentTab.module.css'
import { TOPICS, invalidate, useDataRevision } from '../../shared/stores/invalidationStore'

function getInitials(name?: string): string {
  if (!name || !name.trim()) return 'U'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  return name.substring(0, 2).toUpperCase()
}

function getModuleIcon(key: string, label: string) {
  const lower = (key + ' ' + label).toLowerCase()
  if (lower.includes('user')) return <Icon.Users width={14} height={14} />
  if (lower.includes('role')) return <Icon.Shield width={14} height={14} />
  if (lower.includes('app')) return <Icon.Layers width={14} height={14} />
  if (lower.includes('audit')) return <Icon.Activity width={14} height={14} />
  if (lower.includes('customer')) return <Icon.Users width={14} height={14} />
  if (lower.includes('employee')) return <Icon.Users width={14} height={14} />
  if (lower.includes('lead')) return <Icon.FileText width={14} height={14} />
  if (lower.includes('checker') || lower.includes('approval')) return <Icon.UserCheck width={14} height={14} />
  return <Icon.Layers width={14} height={14} />
}

interface AppGroup {
  id: string
  key: string
  name: string
  isHost: boolean
  iconKey?: string | null
  modules: AssignableModuleDto[]
  gatedCount: number
  totalCheckers: number
}

export function SettingsCheckerAssignmentTab() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const isAdministrator = Boolean(useAuthStore((s) => s.user)?.isAdministrator)
  const hasCapability = useAuthStore((s) => s.hasCapability)
  const pushLayer = useSettingsDrawerStore((s) => s.pushLayer)
  const dataRevision = useDataRevision(TOPICS.checkerAssignments)
  const canManage = isAdministrator || hasCapability('host.system.checker-assignment', 'Manage')

  const [modules, setModules] = useState<AssignableModuleDto[]>([])
  const [remoteApps, setRemoteApps] = useState<RemoteAppDto[]>([])
  const [assignments, setAssignments] = useState<CheckerAssignmentDto[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedAppId, setSelectedAppId] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<'all' | 'gated' | 'ungated'>('all')
  const [pendingRemove, setPendingRemove] = useState<CheckerAssignmentDto | null>(null)
  const [removing, setRemoving] = useState(false)

  // Searchable Application dropdown states
  const [appDropdownOpen, setAppDropdownOpen] = useState(false)
  const [appSearch, setAppSearch] = useState('')
  const appDropdownRef = useRef<HTMLDivElement>(null)
  useClickOutside([appDropdownRef], () => setAppDropdownOpen(false), appDropdownOpen)

  // Collapsible sections state (all expanded by default)
  const [expandedApps, setExpandedApps] = useState<Record<string, boolean>>({})

  const debouncedSearch = useDebouncedValue(search, 250)

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const [modulesRes, assignmentsRes, appsRes] = await Promise.all([
          checkerAssignmentsApi.listModules(accessToken!),
          checkerAssignmentsApi.list(accessToken!),
          remoteAppsApi.list(accessToken!, { pageSize: 100 }).catch(() => ({ items: [], total: 0 })),
        ])
        if (cancelled) return
        setModules(modulesRes)
        setAssignments(assignmentsRes)
        setRemoteApps(appsRes.items)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Could not load checker assignments.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [accessToken, dataRevision])

  // Group modules by Application (Host Platform + Remote Apps)
  const appGroups = useMemo<AppGroup[]>(() => {
    const groups: AppGroup[] = []

    // 1. Host Platform
    const hostModules = modules.filter((m) => m.key.startsWith('host.') || !m.key.startsWith('remote.'))
    const hostGated = hostModules.filter((m) => assignments.some((a) => a.module === m.key)).length
    const hostCheckers = assignments.filter((a) => hostModules.some((m) => m.key === a.module)).length

    if (hostModules.length > 0 || remoteApps.length === 0) {
      groups.push({
        id: 'host',
        key: 'host.platform',
        name: 'Host Platform (Core)',
        isHost: true,
        iconKey: 'Shield',
        modules: hostModules,
        gatedCount: hostGated,
        totalCheckers: hostCheckers,
      })
    }

    // 2. Remote Applications
    const assignedModuleKeys = new Set(hostModules.map((m) => m.key))

    for (const app of remoteApps) {
      const appModules = modules.filter((m) => {
        const key = m.key.toLowerCase()
        const appKey = app.key.toLowerCase()
        return key === `remote.${appKey}` || key.startsWith(`remote.${appKey}.`) || key.includes(appKey)
      })

      appModules.forEach((m) => assignedModuleKeys.add(m.key))

      const appGated = appModules.filter((m) => assignments.some((a) => a.module === m.key)).length
      const appCheckers = assignments.filter((a) => appModules.some((m) => m.key === a.module)).length

      groups.push({
        id: app.id,
        key: app.key,
        name: app.displayName,
        isHost: false,
        iconKey: app.iconKey,
        modules: appModules,
        gatedCount: appGated,
        totalCheckers: appCheckers,
      })
    }

    // 3. Fallback for any unmapped remote modules
    const remainingRemoteModules = modules.filter((m) => !assignedModuleKeys.has(m.key) && m.key.startsWith('remote.'))
    if (remainingRemoteModules.length > 0) {
      const remGated = remainingRemoteModules.filter((m) => assignments.some((a) => a.module === m.key)).length
      const remCheckers = assignments.filter((a) => remainingRemoteModules.some((m) => m.key === a.module)).length

      groups.push({
        id: 'other-remotes',
        key: 'remote.extensions',
        name: 'Other Remote Microfrontends',
        isHost: false,
        iconKey: 'Layers',
        modules: remainingRemoteModules,
        gatedCount: remGated,
        totalCheckers: remCheckers,
      })
    }

    return groups
  }, [modules, remoteApps, assignments])

  // Initialize expanded apps state when apps load
  useEffect(() => {
    if (appGroups.length > 0) {
      setExpandedApps((prev) => {
        const next = { ...prev }
        appGroups.forEach((g) => {
          if (next[g.id] === undefined) {
            next[g.id] = true
          }
        })
        return next
      })
    }
  }, [appGroups])

  // Filtered app groups & modules
  const filteredAppGroups = useMemo(() => {
    const q = debouncedSearch.toLowerCase().trim()

    return appGroups
      .filter((group) => {
        if (selectedAppId !== 'all' && group.id !== selectedAppId) return false
        return true
      })
      .map((group) => {
        const matchingModules = group.modules.filter((mod) => {
          const modAssignments = assignments.filter((a) => a.module === mod.key)
          const isGated = modAssignments.length > 0

          if (statusFilter === 'gated' && !isGated) return false
          if (statusFilter === 'ungated' && isGated) return false

          if (!q) return true

          // Match query against app name, module label, module key, or checker user name
          if (group.name.toLowerCase().includes(q)) return true
          if (mod.label.toLowerCase().includes(q) || mod.key.toLowerCase().includes(q)) return true
          if (modAssignments.some((a) => a.checkerName?.toLowerCase().includes(q))) return true

          return false
        })

        return {
          ...group,
          filteredModules: matchingModules,
        }
      })
      .filter((group) => group.filteredModules.length > 0)
  }, [appGroups, selectedAppId, statusFilter, debouncedSearch, assignments])

  const totalFilteredModulesCount = useMemo(() => {
    return filteredAppGroups.reduce((acc, g) => acc + g.filteredModules.length, 0)
  }, [filteredAppGroups])

  const totalGatedModules = useMemo(() => {
    return appGroups.reduce((acc, g) => acc + g.gatedCount, 0)
  }, [appGroups])

  // Searchable apps in dropdown
  const filteredDropdownApps = useMemo(() => {
    if (!appSearch.trim()) return appGroups
    const q = appSearch.toLowerCase().trim()
    return appGroups.filter((g) => g.name.toLowerCase().includes(q) || g.key.toLowerCase().includes(q))
  }, [appGroups, appSearch])

  const selectedAppObj = useMemo(() => {
    if (selectedAppId === 'all') return null
    return appGroups.find((g) => g.id === selectedAppId) ?? null
  }, [appGroups, selectedAppId])

  // Toggle single app accordion
  function toggleAppCollapse(appId: string) {
    setExpandedApps((prev) => ({
      ...prev,
      [appId]: !prev[appId],
    }))
  }

  // Toggle all accordions
  const allExpanded = useMemo(() => {
    return filteredAppGroups.every((g) => expandedApps[g.id] !== false)
  }, [filteredAppGroups, expandedApps])

  function toggleAllApps() {
    const nextState = !allExpanded
    const updated: Record<string, boolean> = {}
    appGroups.forEach((g) => {
      updated[g.id] = nextState
    })
    setExpandedApps(updated)
  }

  async function confirmRemove() {
    if (!pendingRemove || !accessToken) return
    setRemoving(true)
    try {
      await checkerAssignmentsApi.remove(accessToken, pendingRemove.id)
      setPendingRemove(null)
      toast.success(`${pendingRemove.checkerName} is no longer a checker for '${pendingRemove.module}'.`)
      invalidate(TOPICS.checkerAssignments)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove this checker.')
      setPendingRemove(null)
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className={styles.container}>
      {/* Radiant Gradient Header */}
      <div className={styles.header}>
        <div className={styles.headerTitleWrap}>
          <div className={styles.headerIconBox}>
            <Icon.UserCheck width={19} height={19} />
          </div>
          <div>
            <h3 className={styles.title}>Checker Governance &amp; Assignments</h3>
            <p className={styles.subtitle}>
              Manage Maker-Checker rules across Host Platform and Remote Microfrontend Applications.
            </p>
          </div>
        </div>

        {canManage && (
          <button
            type="button"
            className={styles.createButton}
            onClick={() => pushLayer({ type: 'checker-assignment-form' })}
          >
            <Icon.Plus width={14} height={14} />
            <span>Assign Checker</span>
          </button>
        )}
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          {error}
        </div>
      )}

      {/* Top Controls: Searchable App Dropdown + Filter Controls */}
      <div className={styles.topControlsWrap}>
        {/* Row 1: Searchable Application Overview Dropdown & Expand All */}
        <div className={styles.appSelectorRow}>
          <div className={styles.appSelectorWrap} ref={appDropdownRef}>
            <button
              type="button"
              className={`${styles.appSelectorTrigger} ${appDropdownOpen ? styles.appSelectorTriggerOpen : ''}`}
              onClick={() => setAppDropdownOpen((v) => !v)}
              aria-expanded={appDropdownOpen}
            >
              <div className={styles.triggerLeft}>
                {selectedAppObj ? (
                  <>
                    <div
                      className={`${styles.triggerAppIcon} ${
                        selectedAppObj.isHost ? styles.iconBoxHost : styles.iconBoxRemote
                      }`}
                    >
                      {resolveIcon(selectedAppObj.iconKey, selectedAppObj.isHost ? Icon.Shield : Icon.Box)({
                        width: 14,
                        height: 14,
                      })}
                    </div>
                    <div className={styles.triggerDetails}>
                      <span className={styles.triggerLabel}>Application:</span>
                      <span className={styles.triggerAppName}>{selectedAppObj.name}</span>
                      <span className={styles.triggerGatedBadge}>
                        {selectedAppObj.gatedCount} of {selectedAppObj.modules.length} Gated
                      </span>
                    </div>
                  </>
                ) : (
                  <>
                    <div className={`${styles.triggerAppIcon} ${styles.iconBoxHost}`}>
                      <Icon.Layers width={14} height={14} />
                    </div>
                    <div className={styles.triggerDetails}>
                      <span className={styles.triggerLabel}>Application:</span>
                      <span className={styles.triggerAppName}>All Applications</span>
                      <span className={styles.triggerGatedBadge}>
                        {totalGatedModules} of {modules.length} Gated
                      </span>
                    </div>
                  </>
                )}
              </div>
              <div className={`${styles.triggerChevron} ${appDropdownOpen ? styles.triggerChevronOpen : ''}`}>
                <Icon.ChevronDown width={14} height={14} />
              </div>
            </button>

            {/* Dropdown Menu with Live Search */}
            {appDropdownOpen && (
              <div className={styles.appSelectorMenu}>
                <div className={styles.appSelectorSearchWrap}>
                  <input
                    type="text"
                    className={styles.appSelectorSearchInput}
                    placeholder="Search application name or key..."
                    value={appSearch}
                    onChange={(e) => setAppSearch(e.target.value)}
                    autoFocus
                  />
                  <Icon.Search width={13} height={13} className={styles.appSelectorSearchIcon} />
                </div>

                <div className={styles.appSelectorList}>
                  {/* All Applications Option */}
                  <button
                    type="button"
                    className={`${styles.appSelectorItem} ${selectedAppId === 'all' ? styles.appSelectorItemSelected : ''}`}
                    onClick={() => {
                      setSelectedAppId('all')
                      setAppDropdownOpen(false)
                      setAppSearch('')
                    }}
                  >
                    <div className={styles.appSelectorItemLeft}>
                      <div className={`${styles.appSelectorItemIcon} ${styles.iconBoxHost}`}>
                        <Icon.Layers width={13} height={13} />
                      </div>
                      <span className={styles.appSelectorItemName}>All Applications</span>
                    </div>
                    <div className={styles.appSelectorItemRight}>
                      <span className={styles.appSelectorItemBadge}>{totalGatedModules} Gated</span>
                      {selectedAppId === 'all' && <Icon.Check width={13} height={13} style={{ color: '#2563eb' }} />}
                    </div>
                  </button>

                  {/* Filtered Apps */}
                  {filteredDropdownApps.map((app) => {
                    const ItemIcon = resolveIcon(app.iconKey, app.isHost ? Icon.Shield : Icon.Box)
                    const isSelected = selectedAppId === app.id

                    return (
                      <button
                        key={app.id}
                        type="button"
                        className={`${styles.appSelectorItem} ${isSelected ? styles.appSelectorItemSelected : ''}`}
                        onClick={() => {
                          setSelectedAppId(app.id)
                          setAppDropdownOpen(false)
                          setAppSearch('')
                        }}
                      >
                        <div className={styles.appSelectorItemLeft}>
                          <div
                            className={`${styles.appSelectorItemIcon} ${
                              app.isHost ? styles.iconBoxHost : styles.iconBoxRemote
                            }`}
                          >
                            <ItemIcon width={13} height={13} />
                          </div>
                          <span className={styles.appSelectorItemName}>{app.name}</span>
                        </div>
                        <div className={styles.appSelectorItemRight}>
                          <span className={styles.appSelectorItemBadge}>
                            {app.gatedCount}/{app.modules.length} Gated
                          </span>
                          {isSelected && <Icon.Check width={13} height={13} style={{ color: '#2563eb' }} />}
                        </div>
                      </button>
                    )
                  })}

                  {filteredDropdownApps.length === 0 && (
                    <div className={styles.appSelectorItemEmpty}>No applications match &quot;{appSearch}&quot;</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Quick Expand / Collapse All Accordions Button */}
          <button
            type="button"
            className={styles.expandAllBtn}
            onClick={toggleAllApps}
            title={allExpanded ? 'Collapse all applications' : 'Expand all applications'}
          >
            <Icon.ChevronDown
              width={13}
              height={13}
              style={{
                transform: allExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                transition: 'transform 0.15s ease',
              }}
            />
            <span>{allExpanded ? 'Collapse All' : 'Expand All'}</span>
          </button>
        </div>

        {/* Row 2: Search & Status Filters */}
        <div className={styles.filterToolbar}>
          <div className={styles.searchWrap}>
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search by module name, key, or checker user..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <Icon.Search width={14} height={14} className={styles.searchIcon} />
            {search && (
              <button
                type="button"
                className={styles.clearSearchBtn}
                onClick={() => setSearch('')}
                aria-label="Clear search query"
              >
                <Icon.X width={12} height={12} />
              </button>
            )}
          </div>

          {/* Quick Filter Pills */}
          <div className={styles.filterPills}>
            <button
              type="button"
              className={`${styles.filterPill} ${statusFilter === 'all' ? styles.filterPillActive : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              All Modules
            </button>
            <button
              type="button"
              className={`${styles.filterPill} ${statusFilter === 'gated' ? styles.filterPillActive : ''}`}
              onClick={() => setStatusFilter('gated')}
            >
              Gated ({totalGatedModules})
            </button>
            <button
              type="button"
              className={`${styles.filterPill} ${statusFilter === 'ungated' ? styles.filterPillActive : ''}`}
              onClick={() => setStatusFilter('ungated')}
            >
              Ungated ({Math.max(0, modules.length - totalGatedModules)})
            </button>
          </div>

          <span className={styles.countBadge}>
            {totalFilteredModulesCount} module{totalFilteredModulesCount === 1 ? '' : 's'}
          </span>
        </div>
      </div>

      {/* Hierarchical Application Sections List (Collapsible) */}
      <div className={styles.appSectionsList}>
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className={styles.skeletonCard}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <SkeletonBlock height={20} width="35%" />
                <SkeletonBlock height={20} width="80px" radius="999px" />
              </div>
              <SkeletonBlock height={14} width="60%" />
              <SkeletonBlock height={32} width="100%" radius="8px" />
            </div>
          ))
        ) : filteredAppGroups.length === 0 ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyIconBox}>
              <Icon.Search width={20} height={20} />
            </div>
            <h4 className={styles.emptyTitle}>No matching modules found</h4>
            <p className={styles.emptyDesc}>
              {search || statusFilter !== 'all' || selectedAppId !== 'all'
                ? 'Try clearing your search keyword, app filter, or status filter.'
                : 'No registered modules or checker assignments available.'}
            </p>
            {(search || statusFilter !== 'all' || selectedAppId !== 'all') && (
              <button
                type="button"
                className={styles.clearFiltersBtn}
                onClick={() => {
                  setSearch('')
                  setStatusFilter('all')
                  setSelectedAppId('all')
                }}
              >
                Clear all filters
              </button>
            )}
          </div>
        ) : (
          filteredAppGroups.map((app) => {
            const AppHeaderIcon = resolveIcon(app.iconKey, app.isHost ? Icon.Shield : Icon.Box)
            const isExpanded = expandedApps[app.id] !== false

            return (
              <div key={app.id} className={styles.appSection}>
                {/* Collapsible Application Section Header */}
                <div
                  className={`${styles.appSectionHeader} ${
                    !isExpanded ? styles.appSectionHeaderCollapsed : ''
                  } ${app.isHost ? styles.appSectionHeaderHost : styles.appSectionHeaderRemote}`}
                  onClick={() => toggleAppCollapse(app.id)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault()
                      toggleAppCollapse(app.id)
                    }
                  }}
                  aria-expanded={isExpanded}
                >
                  <div className={styles.appSectionLeft}>
                    <div
                      className={`${styles.accordionChevron} ${
                        !isExpanded ? styles.accordionChevronCollapsed : ''
                      }`}
                    >
                      <Icon.ChevronDown width={14} height={14} />
                    </div>
                    <div
                      className={`${styles.appSectionIcon} ${
                        app.isHost ? styles.iconBoxHost : styles.iconBoxRemote
                      }`}
                    >
                      <AppHeaderIcon width={14} height={14} />
                    </div>
                    <span className={styles.appSectionTitle}>{app.name}</span>
                    <span className={styles.appSectionKey}>{app.key}</span>
                    <span
                      className={`${styles.appSectionSummaryBadge} ${
                        app.gatedCount > 0 ? styles.badgeGatedApp : styles.badgeUngatedApp
                      }`}
                    >
                      {app.gatedCount} of {app.modules.length} Gated
                    </span>
                  </div>

                  <div className={styles.appSectionRight} onClick={(e) => e.stopPropagation()}>
                    {canManage && (
                      <button
                        type="button"
                        className={styles.appSectionAddBtn}
                        onClick={() =>
                          pushLayer({
                            type: 'checker-assignment-form',
                            module: app.modules.length > 0 ? app.modules[0].key : undefined,
                          })
                        }
                      >
                        <Icon.Plus width={11} height={11} />
                        <span>Assign Checker</span>
                      </button>
                    )}
                  </div>
                </div>

                {/* Collapsible Modules Container under this Application */}
                {isExpanded && (
                  <div className={styles.appModulesGrid}>
                    {app.filteredModules.map((mod) => {
                      const modAssignments = assignments.filter((a) => a.module === mod.key)
                      const isGated = modAssignments.length > 0

                      return (
                        <div key={mod.key} className={styles.moduleCard}>
                          <div className={styles.moduleTopRow}>
                            <div className={styles.moduleHeaderLeft}>
                              <div className={styles.moduleIconBox}>
                                {getModuleIcon(mod.key, mod.label)}
                              </div>
                              <div className={styles.moduleTitleBlock}>
                                <span className={styles.moduleName}>{mod.label}</span>
                                <span className={styles.moduleKeyTag}>{mod.key}</span>
                                {isGated ? (
                                  <span className={styles.badgeGated}>
                                    <span className={styles.badgeDotGreen} />
                                    Gated ({modAssignments.length} Checker{modAssignments.length === 1 ? '' : 's'})
                                  </span>
                                ) : (
                                  <span className={styles.badgeUngated}>
                                    <span className={styles.badgeDotGray} />
                                    Ungated
                                  </span>
                                )}
                              </div>
                            </div>

                            {canManage && (
                              <button
                                type="button"
                                className={styles.cardAddBtn}
                                onClick={() => pushLayer({ type: 'checker-assignment-form', module: mod.key })}
                              >
                                <Icon.Plus width={11} height={11} />
                                <span>Add</span>
                              </button>
                            )}
                          </div>

                          {/* Checkers Assigned */}
                          <div className={styles.checkersSection}>
                            {modAssignments.length === 0 ? (
                              <p className={styles.ungatedNotice}>
                                <Icon.Info width={12} height={12} style={{ flexShrink: 0 }} />
                                <span>Not gated — direct apply.</span>
                              </p>
                            ) : (
                              <div className={styles.checkerChipsWrap}>
                                {modAssignments.map((a) => (
                                  <div key={a.id} className={styles.checkerCardChip}>
                                    <div className={styles.checkerAvatarSmall}>
                                      {getInitials(a.checkerName)}
                                    </div>
                                    <span>{a.checkerName}</span>
                                    {canManage && (
                                      <button
                                        type="button"
                                        className={styles.chipDeleteBtn}
                                        onClick={() => setPendingRemove(a)}
                                        aria-label={`Remove ${a.checkerName} as checker`}
                                      >
                                        <Icon.X width={10} height={10} />
                                      </button>
                                    )}
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      {/* Concise Removal Confirmation Modal */}
      <Modal
        open={Boolean(pendingRemove)}
        title={`Remove ${pendingRemove?.checkerName} as checker?`}
        onClose={() => setPendingRemove(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setPendingRemove(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={removing} onClick={confirmRemove}>
              Remove
            </Button>
          </>
        }
      >
        <p style={{ margin: 0, fontSize: '13px', color: '#1e293b', lineHeight: 1.5 }}>
          <strong>{pendingRemove?.checkerName}</strong> will no longer be an approver for{' '}
          <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: '4px' }}>
            {pendingRemove?.module}
          </code>
          .
        </p>
        <p style={{ margin: '8px 0 0', fontSize: '12px', color: '#64748b', lineHeight: 1.4 }}>
          Pending requests will reassign to remaining checkers, or the module will become ungated if no checkers remain.
        </p>
      </Modal>
    </div>
  )
}

