import { useEffect, useMemo, useRef, useState } from 'react'
import { useAuthStore } from '../../features/auth/store/authStore'
import { checkerAssignmentsApi, type AssignableModuleDto, type CheckerAssignmentDto } from '../../features/approvals/api/checkerAssignmentsApi'
import { groupModulesByApp, type ModuleAppGroup } from '../../features/approvals/utils/moduleAppGrouping'
import { remoteAppsApi, type RemoteAppDto } from '../../features/settings-applications/api/remoteAppsApi'
import { useSettingsDrawerStore } from '../../shared/stores/settingsDrawerStore'
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue'
import { useClickOutside } from '../../shared/hooks/useClickOutside'
import { Icon } from '../../shared/components/Icon/Icon'
import { resolveIcon } from '../../shared/components/Icon/resolveIcon'
import { SkeletonBlock } from '../../shared/components/Skeleton'
import { ApiError } from '../../shared/api/httpClient'
import { toast } from '../../shared/stores/toastStore'
import styles from './SettingsCheckerAssignmentTab.module.css'
import { TOPICS, invalidate, useDataRevision } from '../../shared/stores/invalidationStore'
import { Button, Modal, SearchField, getInitials, useSuggestions, type SearchFieldSuggestion } from '@omniconnect/ui'
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

interface AppGroup extends ModuleAppGroup {
  gatedCount: number
  totalCheckers: number
}

export function SettingsCheckerAssignmentTab() {
  const accessToken = useAuthStore((s) => s.accessToken)
  // A token refresh must not re-run a load (and reset what the user is editing) — only its first arrival.
  const hasAccessToken = Boolean(accessToken)
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

  // Collapsible sections state (all collapsed by default — the operator opens what they need)
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
  }, [hasAccessToken, dataRevision])

  // Group modules by Application (Host Platform + Remote Apps), then layer in this page's own
  // gated/checker counts — the grouping itself is shared with the assignment form's "whole
  // application" bulk-assign scope so both stay in sync.
  const appGroups = useMemo<AppGroup[]>(() => {
    return groupModulesByApp(modules, remoteApps).map((group) => ({
      ...group,
      gatedCount: group.modules.filter((m) => assignments.some((a) => a.module === m.key)).length,
      totalCheckers: assignments.filter((a) => group.modules.some((m) => m.key === a.module)).length,
    }))
  }, [modules, remoteApps, assignments])

  // Initialize expanded apps state when apps load — collapsed until the operator opts in
  useEffect(() => {
    if (appGroups.length > 0) {
      setExpandedApps((prev) => {
        const next = { ...prev }
        appGroups.forEach((g) => {
          if (next[g.id] === undefined) {
            next[g.id] = false
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

  /*
   * Recommendations for the toolbar search — the same two things the filter above matches on, drawn
   * from data already loaded: module labels (qualified by their application) and the names of
   * checkers actually assigned. Nothing fetched, nothing offered that this list could not show.
   */
  const searchPool = useMemo(() => {
    const pool: { value: string; meta?: string }[] = []
    for (const group of appGroups) {
      for (const mod of group.modules) pool.push({ value: mod.label, meta: group.name })
    }
    for (const a of assignments) {
      if (a.checkerName) pool.push({ value: a.checkerName, meta: 'Checker' })
    }
    return pool
  }, [appGroups, assignments])

  const searchHits = useSuggestions(search, searchPool, { delayMs: 250 })
  const searchSuggestions: SearchFieldSuggestion[] = searchHits.items.map((s) => ({
    id: s.value,
    label: (
      <span className={styles.suggestionRow}>
        <span className={styles.suggestionPrimary}>{s.value}</span>
        {s.meta && <span className={styles.suggestionSecondary}>{s.meta}</span>}
      </span>
    ),
  }))

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
                    placeholder="Search application name..."
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
                      {selectedAppId === 'all' && <Icon.Check width={13} height={13} className={styles.cat1} />}
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
                          {isSelected && <Icon.Check width={13} height={13} className={styles.cat1} />}
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
              className={`${styles.expandChevron}${allExpanded ? '' : ` ${styles.expandChevronCollapsed}`}`}
            />
            <span>{allExpanded ? 'Collapse All' : 'Expand All'}</span>
          </button>
        </div>

        {/* Row 2: Search & Status Filters */}
        <div className={styles.filterToolbar}>
          {/* Shared SearchField rather than a local input + hand-rolled clear button, so this box
              recommends as you type like every other search on the platform. */}
          <SearchField
            className={styles.searchWrap}
            placeholder="Search by module or checker name..."
            value={search}
            onValueChange={setSearch}
            suggestions={searchSuggestions}
            onSelectSuggestion={(s) => setSearch(s.id)}
            emptyHint="No matching module or checker."
          />

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
              <div className={styles.cat2}>
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
                    <span
                      className={`${styles.appSectionSummaryBadge} ${
                        app.gatedCount > 0 ? styles.badgeGatedApp : styles.badgeUngatedApp
                      }`}
                    >
                      {app.gatedCount} of {app.modules.length} Gated
                    </span>
                  </div>

                  {canManage && app.modules.length > 0 && (
                    <div className={styles.appSectionRight} onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className={styles.appSectionAddBtn}
                        title={`Assign one checker to all ${app.modules.length} module${app.modules.length === 1 ? '' : 's'} in ${app.name} at once`}
                        onClick={() => pushLayer({ type: 'checker-assignment-form', appId: app.id })}
                      >
                        <Icon.Users width={11} height={11} />
                        <span>Assign to Whole App</span>
                      </button>
                    </div>
                  )}
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
                                <Icon.Info width={12} height={12} className={styles.cat3} />
                                <span>Not gated — direct apply.</span>
                              </p>
                            ) : (
                              <div className={styles.checkerChipsWrap}>
                                {modAssignments.map((a) => (
                                  <div key={a.id} className={styles.checkerCardChip}>
                                    {/*
                                      A role assignment gets a shield rather than initials, and states
                                      how many active members it currently expands to. "Assigned to
                                      Manager" on its own says nothing about whether anyone can
                                      actually approve — a role that has emptied out gates the module
                                      with no way to clear the queue, and that has to be visible here.
                                    */}
                                    <div
                                      className={a.isRole ? styles.checkerRoleIconSmall : styles.checkerAvatarSmall}
                                      title={a.isRole ? 'Role — any active member can approve' : undefined}
                                    >
                                      {a.isRole ? <Icon.ShieldCheck width={12} height={12} /> : getInitials(a.checkerName)}
                                    </div>
                                    <span>{a.checkerName}</span>
                                    {a.isRole && (
                                      <span
                                        className={a.memberCount === 0 ? styles.memberCountEmpty : styles.memberCount}
                                        title={
                                          a.memberCount === 0
                                            ? 'This role has no active members, so nobody can approve for this module.'
                                            : `${a.memberCount} active member(s) can approve`
                                        }
                                      >
                                        {a.memberCount ?? 0}
                                      </span>
                                    )}
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
        <p className={styles.cat4}>
          <strong>{pendingRemove?.checkerName}</strong> will no longer be an approver for{' '}
          <code className={styles.cat5}>
            {pendingRemove?.module}
          </code>
          .
        </p>
        <p className={styles.cat6}>
          Pending requests will reassign to remaining checkers, or the module will become ungated if no checkers remain.
        </p>
      </Modal>
    </div>
  )
}

