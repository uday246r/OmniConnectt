import { useMemo, useState } from 'react'
import { ColumnFilter, FilterBar, useDebouncedValue, type ActiveFilter, type ColumnFilterOption } from '@omniconnect/ui'
import { Icon } from '../../../../shared/components/Icon/Icon'
import type { PermissionFeatureDto } from '../../../../shared/api/permissionsApi'
import type { HealthEntryDto } from '../../../settings-applications/api/remoteAppsApi'
import { groupPermissionsByApp } from '../../../profile/utils/formatUserPermissions'
import styles from './PermissionMatrixTable.module.css'

/** Super-admin capability grid, grouped by application so each app renders its icon/name/badge once (rowSpan) instead of per row. */
const ADMIN_CAPABILITY_GROUPS = [
  {
    app: 'Host Platform',
    source: 'Host',
    rows: [
      { module: 'Users', name: 'User Management', verb: 'Manage', tone: 'manage', desc: 'Full authority to create, edit, deactivate, and assign roles to users.' },
      { module: 'Roles', name: 'Role & RBAC Configuration', verb: 'Manage', tone: 'manage', desc: 'Manage system roles, assign application scopes, and fine-tune permission grants.' },
      { module: 'Applications', name: 'Micro-Frontend Registry', verb: 'Register', tone: 'register', desc: 'Register, configure, and monitor Module Federation remote micro-frontends.' },
      { module: 'Audit Logs', name: 'System Security Audit Trail', verb: 'View', tone: 'view', desc: 'Real-time visibility into authentication logs and administrative actions.' },
      { module: 'Approvals', name: 'Checker & Approval Control', verb: 'Approve', tone: 'approve', desc: 'Full control over maker-checker workflows and approval queues.' },
    ],
  },
  {
    app: 'All Remotes',
    source: 'Remote',
    rows: [
      { module: 'All Modules', name: 'Complete Remote Access', verb: 'Full Access', tone: 'approve', desc: 'Unrestricted access to all registered micro-frontend applications.' },
    ],
  },
] as const

function getVerbClass(tone: string): string {
  switch (tone) {
    case 'view':     return styles.verbView
    case 'create':   return styles.verbCreate
    case 'register': return styles.verbRegister
    case 'edit':     return styles.verbEdit
    case 'manage':   return styles.verbManage
    case 'disable':  return styles.verbDisable
    case 'delete':   return styles.verbDelete
    case 'approve':  return styles.verbApprove
    case 'export':   return styles.verbExport
    case 'kpi':      return styles.verbKpi
    default:         return styles.verbDefault
  }
}

export interface PermissionMatrixTableProps {
  /** Flat "featureKey:Capability" strings — the caller computes these (the logged-in user's own session permissions, or another user's merged role + override set). Ignored when `isAdministrator` is true. */
  permissions: string[]
  catalog: PermissionFeatureDto[]
  registryApps: HealthEntryDto[]
  isAdministrator: boolean
  roleName?: string | null
}

/**
 * The platform's "Application | Module | Permission | Type | Description | Access" table —
 * shared by the Profile page (a user's own capabilities) and the Users & Roles detail page (an
 * arbitrary user's merged role + override permissions). One implementation so both stay visually
 * and behaviorally identical.
 */
export function PermissionMatrixTable({ permissions, catalog, registryApps, isAdministrator, roleName }: PermissionMatrixTableProps) {
  const [appFilter, setAppFilter] = useState('')
  const [permSearch, setPermSearch] = useState('')
  // The grid re-derives every group, module and capability on each change, so running it raw on
  // every keystroke rebuilt the whole matrix per character. 200ms is the platform's convention for
  // filtering an already-loaded pool.
  const debouncedPermSearch = useDebouncedValue(permSearch, 200)

  const appGroups = useMemo(
    () => groupPermissionsByApp(permissions, catalog, registryApps),
    [permissions, catalog, registryApps],
  )

  const appOptions: ColumnFilterOption[] = useMemo(
    () => appGroups.map((g) => ({ value: g.appKey, label: g.appName })),
    [appGroups],
  )

  const filteredAppGroups = useMemo(() => {
    let result = appGroups

    if (appFilter) {
      result = result.filter((g) => g.appKey === appFilter)
    }

    if (!debouncedPermSearch.trim()) return result

    const q = debouncedPermSearch.toLowerCase().trim()
    return result
      .map((group) => {
        const filteredModules = group.modules
          .map((mod) => ({
            ...mod,
            capabilities: mod.capabilities.filter(
              (cap) =>
                cap.actionTitle.toLowerCase().includes(q) ||
                cap.description.toLowerCase().includes(q) ||
                cap.moduleName.toLowerCase().includes(q) ||
                cap.verb.toLowerCase().includes(q) ||
                cap.raw.toLowerCase().includes(q) ||
                cap.appName.toLowerCase().includes(q),
            ),
          }))
          .filter((mod) => mod.capabilities.length > 0)

        const totalCount = filteredModules.reduce((acc, m) => acc + m.capabilities.length, 0)
        return {
          ...group,
          totalCount,
          modules: filteredModules,
        }
      })
      .filter((group) => group.modules.length > 0)
  }, [appGroups, appFilter, debouncedPermSearch])

  /*
   * Recommendations for the Permission column. Sourced from the capabilities already grouped for
   * this table and narrowed by the Application filter when one is set, so the list never offers a
   * permission the current view could not show. Module name disambiguates same-named actions
   * ("View" exists under half a dozen modules).
   */
  const permissionPool = useMemo(
    () =>
      appGroups
        .filter((g) => !appFilter || g.appKey === appFilter)
        .flatMap((g) =>
          g.modules.flatMap((mod) =>
            mod.capabilities.map((cap) => ({
              value: cap.actionTitle,
              meta: `${cap.appName} · ${cap.moduleName}`,
            })),
          ),
        ),
    [appGroups, appFilter],
  )

  const activeFilters: ActiveFilter[] = [
    appFilter && {
      key: 'app',
      label: 'Application',
      value: appGroups.find((g) => g.appKey === appFilter)?.appName ?? appFilter,
      onRemove: () => setAppFilter(''),
    },
    permSearch && { key: 'permission', label: 'Permission', value: `"${permSearch}"`, onRemove: () => setPermSearch('') },
  ].filter(Boolean) as ActiveFilter[]

  if (isAdministrator) {
    return (
      <div className={styles.permTableWrap}>
        <table className={styles.permTable}>
          <thead>
            <tr>
              <th className={styles.permTh}>Application</th>
              <th className={styles.permTh}>Module</th>
              <th className={styles.permTh}>Permission</th>
              <th className={`${styles.permTh} ${styles.permThCenter}`}>Type</th>
              <th className={styles.permTh}>Description</th>
              <th className={`${styles.permTh} ${styles.permThCenter}`}>Access</th>
            </tr>
          </thead>
          <tbody>
            {ADMIN_CAPABILITY_GROUPS.map((group) =>
              group.rows.map((row, rowIdx) => (
                <tr key={`${group.app}-${row.module}`} className={styles.permTr}>
                  {rowIdx === 0 && (
                    <td className={`${styles.permTd} ${styles.permTdApp}`} rowSpan={group.rows.length}>
                      <div className={styles.permAppCell}>
                        <div className={styles.permAppIcon}>
                          <Icon.ShieldCheck width={16} height={16} />
                        </div>
                        <div>
                          <div className={styles.permAppName}>{group.app}</div>
                          <span className={styles.permAppBadge}>{group.source === 'Host' ? 'Core' : 'Remote'}</span>
                        </div>
                      </div>
                    </td>
                  )}
                  <td className={`${styles.permTd} ${styles.permTdModule}`}>
                    <span className={styles.permModuleLabel}>{row.module}</span>
                  </td>
                  <td className={`${styles.permTd} ${styles.permTdName}`}>
                    <span className={styles.permName} title={row.name}>{row.name}</span>
                  </td>
                  <td className={`${styles.permTd} ${styles.permTdType}`}>
                    <span className={`${styles.verbBadge} ${getVerbClass(row.tone)}`}>{row.verb}</span>
                  </td>
                  <td className={`${styles.permTd} ${styles.permTdDesc}`}>
                    <span className={styles.permDesc} title={row.desc}>{row.desc}</span>
                  </td>
                  <td className={`${styles.permTd} ${styles.permTdStatus}`}>
                    <span className={styles.capActivePill}>
                      <Icon.CheckCircle width={11} height={11} />
                      Unrestricted
                    </span>
                  </td>
                </tr>
              )),
            )}
          </tbody>
        </table>
      </div>
    )
  }

  if (permissions.length === 0) {
    return (
      <div className={styles.emptyCapBox}>
        <Icon.ShieldCheck width={24} height={24} color="#94a3b8" />
        <span>Standard application access authorized via role. No granular permission overrides assigned.</span>
      </div>
    )
  }

  return (
    <div className={styles.capControls}>
      {/* Stats */}
      <div className={styles.capStatsRow}>
        <div className={styles.capPillsGroup}>
          <span className={styles.statChip}>
            <Icon.ShieldCheck width={14} height={14} color="var(--omni-color-primary-600)" />
            <span>Total:</span>
            <span className={styles.statChipStrong}>{permissions.length}</span>
          </span>
          <span className={styles.statChip}>
            <Icon.Grid width={14} height={14} color="var(--omni-color-primary-600)" />
            <span>Apps:</span>
            <span className={styles.statChipStrong}>{appGroups.length}</span>
          </span>
          {roleName && (
            <span className={styles.statChip}>
              <Icon.Crown width={14} height={14} color="#f59e0b" />
              <span>Role:</span>
              <span className={styles.statChipStrong}>{roleName}</span>
            </span>
          )}
        </div>
      </div>

      <FilterBar
        filters={activeFilters}
        onClearAll={() => {
          setAppFilter('')
          setPermSearch('')
        }}
      />

      {/* Permission Table */}
      {filteredAppGroups.length === 0 ? (
        <div className={styles.emptyCapBox}>
          <Icon.Search width={22} height={22} color="#94a3b8" />
          <span>No permissions found matching the selected filters.</span>
          <button
            type="button"
            className={styles.clearFilterBtn}
            onClick={() => { setPermSearch(''); setAppFilter('') }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className={styles.permTableWrap}>
          <table className={styles.permTable}>
            <thead>
              <tr>
                <ColumnFilter
                  label="Application"
                  value={appFilter}
                  onChange={setAppFilter}
                  options={appOptions}
                  allLabel="All Applications"
                  searchable
                  className={styles.permTh}
                />
                <th className={styles.permTh}>Module</th>
                <ColumnFilter
                  label="Permission"
                  value={permSearch}
                  onChange={setPermSearch}
                  options={[]}
                  freeText
                  filterType="text"
                  searchPlaceholder="Search permissions..."
                  suggestFrom={permissionPool}
                  emptyHint="No matching permission."
                  className={styles.permTh}
                />
                <th className={`${styles.permTh} ${styles.permThCenter}`}>Type</th>
                <th className={styles.permTh}>Description</th>
                <th className={`${styles.permTh} ${styles.permThCenter}`}>Status</th>
              </tr>
            </thead>
            <tbody>
              {filteredAppGroups.map((group) =>
                group.modules.map((module) =>
                  module.capabilities.map((cap, capIdx) => {
                    const isFirstInModule = capIdx === 0
                    const totalRows = module.capabilities.length
                    return (
                      <tr key={cap.raw} className={styles.permTr}>
                        {isFirstInModule && (
                          <td
                            className={`${styles.permTd} ${styles.permTdApp}`}
                            rowSpan={totalRows}
                          >
                            <div className={styles.permAppCell}>
                              <div className={`${styles.permAppIcon} ${group.appSource !== 'Host' ? styles.permAppIconRemote : ''}`}>
                                {group.appSource === 'Host' ? (
                                  <Icon.ShieldCheck width={16} height={16} />
                                ) : group.appName.toLowerCase().includes('lead') ? (
                                  <Icon.Users width={16} height={16} />
                                ) : group.appName.toLowerCase().includes('customer') ? (
                                  <Icon.Layers width={16} height={16} />
                                ) : (
                                  <Icon.Grid width={16} height={16} />
                                )}
                              </div>
                              <div>
                                <div className={styles.permAppName}>{group.appName}</div>
                                <span className={styles.permAppBadge}>
                                  {group.appSource === 'Host' ? 'Core' : 'Remote'}
                                </span>
                              </div>
                            </div>
                          </td>
                        )}
                        <td className={`${styles.permTd} ${styles.permTdModule}`}>
                          <span className={styles.permModuleLabel}>{cap.moduleName}</span>
                        </td>
                        <td className={`${styles.permTd} ${styles.permTdName}`}>
                          <span className={styles.permName} title={cap.raw}>{cap.actionTitle}</span>
                        </td>
                        <td className={`${styles.permTd} ${styles.permTdType}`}>
                          <span className={`${styles.verbBadge} ${getVerbClass(cap.tone)}`}>
                            {cap.verb}
                          </span>
                        </td>
                        <td className={`${styles.permTd} ${styles.permTdDesc}`}>
                          <span className={styles.permDesc} title={cap.description}>{cap.description}</span>
                        </td>
                        <td className={`${styles.permTd} ${styles.permTdStatus}`}>
                          <span className={styles.capActivePill}>
                            <Icon.CheckCircle width={11} height={11} />
                            Granted
                          </span>
                        </td>
                      </tr>
                    )
                  })
                )
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
