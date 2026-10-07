import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, isSuperAdminOrAdmin } from '../../auth/store/authStore'
import {
  checkerAssignmentsApi,
  type AssignableModuleDto,
  type CheckerAssignmentDto,
} from '../api/checkerAssignmentsApi'
import { groupModulesByApp, type ModuleAppGroup } from '../utils/moduleAppGrouping'
import { remoteAppsApi, type RemoteAppDto } from '../../settings-applications/api/remoteAppsApi'
import { useSettingsDrawerStore } from '../../../shared/stores/settingsDrawerStore'
import { useDebouncedValue } from '../../../shared/hooks/useDebouncedValue'
import { Icon } from '../../../shared/components/Icon/Icon'
import { resolveIcon } from '../../../shared/components/Icon/resolveIcon'
import { ApiError } from '../../../shared/api/httpClient'
import { toast } from '../../../shared/stores/toastStore'
import { TOPICS, invalidate, useDataRevision } from '../../../shared/stores/invalidationStore'
import {
  Badge,
  Button,
  EmptyState,
  Modal,
  PageHeader,
  SearchField,
  Select,
  getInitials,
  type SearchFieldSuggestion,
  type SelectOption,
} from '@omniconnect/ui'
import styles from './CheckerAssignmentPage.module.css'

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

const STATUS_FILTER_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All Governance' },
  { value: 'gated', label: 'Gated Only' },
  { value: 'ungated', label: 'Ungated Only' },
]

export function CheckerAssignmentPage() {
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.accessToken)
  const isAdministrator = useAuthStore((s) => isSuperAdminOrAdmin(s.user))
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

  const [expandedApps, setExpandedApps] = useState<Record<string, boolean>>({})

  const [pendingRemove, setPendingRemove] = useState<CheckerAssignmentDto | null>(null)
  const [removing, setRemoving] = useState(false)
  const [removeError, setRemoveError] = useState<string | null>(null)

  const debouncedSearch = useDebouncedValue(search, 250).trim()

  async function loadData() {
    if (!accessToken) return
    setLoading(true)
    try {
      const [modulesRes, assignmentsRes, appsRes] = await Promise.all([
        checkerAssignmentsApi.listModules(accessToken),
        checkerAssignmentsApi.list(accessToken),
        remoteAppsApi.list(accessToken, { pageSize: 100 }).catch(() => ({ items: [], total: 0 })),
      ])
      setModules(modulesRes)
      setAssignments(assignmentsRes)
      setRemoteApps(appsRes.items)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load checker assignments.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadData()
  }, [accessToken, dataRevision])

  // Group modules by Application
  const appGroups = useMemo<AppGroup[]>(() => {
    return groupModulesByApp(modules, remoteApps).map((group) => ({
      ...group,
      gatedCount: group.modules.filter((m) => assignments.some((a) => a.module === m.key)).length,
      totalCheckers: assignments.filter((a) => group.modules.some((m) => m.key === a.module)).length,
    }))
  }, [modules, remoteApps, assignments])

  // Initialize expanded state: all expanded by default on full page
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
    const q = debouncedSearch.toLowerCase()

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

  // Summary counts
  const totalModulesCount = modules.length
  const totalGatedModules = modules.filter((m) => assignments.some((a) => a.module === m.key)).length
  const totalUngatedModules = Math.max(0, totalModulesCount - totalGatedModules)
  const uniqueCheckersCount = new Set(
    assignments.map((a) => a.checkerUserId || a.checkerRoleId || a.checkerName),
  ).size

  const appFilterOptions: SelectOption[] = useMemo(() => {
    const opts: SelectOption[] = [{ value: 'all', label: 'All Applications' }]
    appGroups.forEach((g) => {
      opts.push({ value: g.id, label: g.name })
    })
    return opts
  }, [appGroups])

  const searchSuggestions: SearchFieldSuggestion[] = useMemo(() => {
    const list: SearchFieldSuggestion[] = []
    for (const group of appGroups) {
      for (const mod of group.modules) {
        list.push({ id: mod.label, label: `${mod.label} (${group.name})` })
      }
    }
    return list.slice(0, 8)
  }, [appGroups])

  function toggleAppExpanded(appId: string) {
    setExpandedApps((prev) => ({ ...prev, [appId]: !prev[appId] }))
  }

  function handleToggleAll(expand: boolean) {
    const next: Record<string, boolean> = {}
    appGroups.forEach((g) => {
      next[g.id] = expand
    })
    setExpandedApps(next)
  }

  const allExpanded = appGroups.length > 0 && appGroups.every((g) => expandedApps[g.id])

  function handleOpenAdd() {
    navigate('/settings/checker-assignment/new')
    pushLayer({ type: 'checker-assignment-form' })
  }

  function handleOpenAssignWholeApp(appId: string) {
    navigate(`/settings/checker-assignment/new?appId=${appId}`)
    pushLayer({ type: 'checker-assignment-form', appId })
  }

  function handleOpenEditModule(moduleKey: string) {
    navigate(`/settings/checker-assignment/${moduleKey}`)
    pushLayer({ type: 'checker-assignment-form', module: moduleKey })
  }

  async function handleConfirmRemove() {
    if (!pendingRemove || !accessToken) return
    setRemoving(true)
    setRemoveError(null)

    try {
      await checkerAssignmentsApi.remove(accessToken, pendingRemove.id)
      toast.success(`Removed checker assignment for '${pendingRemove.checkerName}'.`)
      setPendingRemove(null)
      invalidate(TOPICS.checkerAssignments, TOPICS.approvals, TOPICS.kpis)
    } catch (err) {
      setRemoveError(err instanceof ApiError ? err.message : 'Could not remove checker assignment.')
    } finally {
      setRemoving(false)
    }
  }

  const summaryValue = (val: number | undefined) => (val === undefined ? '—' : val.toLocaleString())

  return (
    <div className={styles.page}>
      <PageHeader
        title="Checker Assignment"
        subtitle="Configure Maker-Checker governance rules and assign checkers to sensitive modules."
        actions={
          canManage && (
            <Button leadingIcon={<Icon.Plus width={16} height={16} />} onClick={handleOpenAdd}>
              Assign Checker
            </Button>
          )
        }
      />

      {/* 4 Summary KPI Cards */}
      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconBlue}`}>
            <Icon.Layers width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Total Modules</span>
            <span className={styles.summaryValue}>{summaryValue(totalModulesCount)}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconPurple}`}>
            <Icon.ShieldCheck width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Gated Modules</span>
            <span className={styles.summaryValue}>{summaryValue(totalGatedModules)}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconGreen}`}>
            <Icon.Unlock width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Ungated Modules</span>
            <span className={styles.summaryValue}>{summaryValue(totalUngatedModules)}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconAmber}`}>
            <Icon.UserCheck width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Active Checkers</span>
            <span className={styles.summaryValue}>{summaryValue(uniqueCheckersCount)}</span>
          </div>
        </div>
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          {error}
        </div>
      )}

      {/* Main Card */}
      <div className={styles.card}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarSearch}>
            <SearchField
              placeholder="Search by module, key, or checker…"
              value={search}
              onValueChange={setSearch}
              suggestions={searchSuggestions}
              onSelectSuggestion={(s) => setSearch(s.id)}
              emptyHint="No matching modules."
            />
          </div>

          <div className={styles.appFilterSelectWrap}>
            <Select
              value={selectedAppId}
              options={appFilterOptions}
              onChange={(e) => setSelectedAppId(e.target.value)}
            />
          </div>

          <div className={styles.statusFilterSelectWrap}>
            <Select
              value={statusFilter}
              options={STATUS_FILTER_OPTIONS}
              onChange={(e) => setStatusFilter(e.target.value as 'all' | 'gated' | 'ungated')}
            />
          </div>

          <div className={styles.toolbarActions}>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleToggleAll(!allExpanded)}
            >
              {allExpanded ? 'Collapse All' : 'Expand All'}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Icon.Activity width={15} height={15} />}
              onClick={() => void loadData()}
            >
              Refresh
            </Button>
          </div>
        </div>

        {/* Grouped Accordions */}
        <div className={styles.groupsContainer}>
          {loading ? (
            <div style={{ padding: '32px', textAlign: 'center', color: '#64748b' }}>
              Loading checker assignments…
            </div>
          ) : filteredAppGroups.length === 0 ? (
            <div style={{ padding: '32px' }}>
              <EmptyState compact title="No modules or applications found matching your criteria." />
            </div>
          ) : (
            filteredAppGroups.map((group) => {
              const GroupIcon = resolveIcon(group.iconKey, group.isHost ? Icon.Shield : Icon.Box)
              const isExpanded = Boolean(expandedApps[group.id])

              return (
                <div key={group.id} className={styles.appGroupSection}>
                  <div
                    className={styles.appGroupHeader}
                    onClick={() => toggleAppExpanded(group.id)}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault()
                        toggleAppExpanded(group.id)
                      }
                    }}
                    aria-expanded={isExpanded}
                  >
                    <div className={styles.appGroupHeaderLeft}>
                      <div
                        className={`${styles.appGroupIconWrap} ${
                          group.isHost ? styles.iconBoxHost : styles.iconBoxRemote
                        }`}
                      >
                        <GroupIcon width={16} height={16} />
                      </div>
                      <span className={styles.appGroupName}>{group.name}</span>
                      <span className={styles.appGroupGatedBadge}>
                        {group.gatedCount} of {group.modules.length} Gated
                      </span>
                    </div>

                    <div className={styles.appGroupHeaderRight}>
                      {canManage && group.modules.length > 0 && (
                        <button
                          type="button"
                          className={styles.assignWholeAppBtn}
                          onClick={(e) => {
                            e.stopPropagation()
                            handleOpenAssignWholeApp(group.id)
                          }}
                          title={`Assign one checker to all ${group.modules.length} modules in ${group.name} at once`}
                        >
                          <Icon.Users width={13} height={13} />
                          <span>Assign to Whole App</span>
                        </button>
                      )}
                      <div className={`${styles.chevronIcon} ${isExpanded ? styles.chevronOpen : ''}`}>
                        <Icon.ChevronDown width={16} height={16} />
                      </div>
                    </div>
                  </div>

                  {isExpanded && (
                    <table className={styles.moduleTable}>
                      <thead className={styles.moduleTableHeader}>
                        <tr>
                          <th style={{ width: '30%' }}>Module</th>
                          <th style={{ width: '18%' }}>Governance</th>
                          <th style={{ width: '38%' }}>Assigned Checkers</th>
                          <th style={{ width: '14%', textAlign: 'right' }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {group.filteredModules.map((mod) => {
                          const modAssignments = assignments.filter((a) => a.module === mod.key)
                          const isGated = modAssignments.length > 0

                          return (
                            <tr key={mod.key} className={styles.moduleRow}>
                              <td>
                                <div className={styles.moduleInfoCell}>
                                  <div className={styles.moduleIcon}>
                                    {getModuleIcon(mod.key, mod.label)}
                                  </div>
                                  <div className={styles.moduleDetails}>
                                    <span className={styles.moduleLabel}>{mod.label}</span>
                                    {/* What a checker assigned here would actually hold. Without it the
                                        row named a module and left the operator to guess. */}
                                    <span className={styles.moduleActions}>
                                      {mod.actions.join(' / ')}
                                    </span>
                                    <span className={styles.moduleKey}>{mod.key}</span>
                                  </div>
                                </div>
                              </td>

                              <td>
                                <Badge tone={isGated ? 'warning' : 'neutral'}>
                                  {isGated ? 'Gated · Approval Required' : 'Ungated · Direct'}
                                </Badge>
                              </td>

                              <td>
                                {isGated ? (
                                  <div className={styles.checkerList}>
                                    {modAssignments.map((assignment) => (
                                      <div key={assignment.id} className={styles.checkerChip}>
                                        <div className={styles.checkerAvatar}>
                                          {getInitials(assignment.checkerName)}
                                        </div>
                                        <span className={styles.checkerName}>
                                          {assignment.checkerName}
                                        </span>
                                        {canManage && (
                                          <button
                                            type="button"
                                            className={styles.checkerRemoveBtn}
                                            onClick={() => {
                                              setRemoveError(null)
                                              setPendingRemove(assignment)
                                            }}
                                            title="Remove checker"
                                          >
                                            <Icon.X width={12} height={12} />
                                          </button>
                                        )}
                                      </div>
                                    ))}
                                  </div>
                                ) : (
                                  <span className={styles.noChecker}>
                                    No checker required (direct execution)
                                  </span>
                                )}
                              </td>

                              <td>
                                <div className={styles.actionCell}>
                                  {canManage && (
                                    <Button
                                      size="sm"
                                      variant={isGated ? 'secondary' : 'secondary'}
                                      leadingIcon={<Icon.Edit width={12} height={12} />}
                                      onClick={() => handleOpenEditModule(mod.key)}
                                    >
                                      {isGated ? 'Manage' : 'Assign'}
                                    </Button>
                                  )}
                                </div>
                              </td>
                            </tr>
                          )
                        })}
                      </tbody>
                    </table>
                  )}
                </div>
              )
            })
          )}
        </div>
      </div>

      {/* Remove Checker Modal */}
      <Modal
        open={Boolean(pendingRemove)}
        onClose={() => !removing && setPendingRemove(null)}
        title="Remove Checker Assignment"
      >
        <div className={styles.modalBody}>
          <p className={styles.modalText}>
            Are you sure you want to remove <strong>{pendingRemove?.checkerName}</strong> as a
            checker for module <strong>&lsquo;{pendingRemove?.module}&rsquo;</strong>?
          </p>
          {removeError && (
            <div className={styles.errorBanner} role="alert">
              {removeError}
            </div>
          )}
          <div className={styles.modalActions}>
            <Button
              variant="secondary"
              onClick={() => setPendingRemove(null)}
              disabled={removing}
            >
              Cancel
            </Button>
            <Button variant="danger" loading={removing} onClick={handleConfirmRemove}>
              Remove Assignment
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
