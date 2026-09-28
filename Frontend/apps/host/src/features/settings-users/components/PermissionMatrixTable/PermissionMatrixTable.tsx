import { useMemo, useState } from 'react'
import { useDebouncedValue } from '@omniconnect/ui'
import { Icon } from '../../../../shared/components/Icon/Icon'
import type { PermissionFeatureDto } from '../../../../shared/api/permissionsApi'
import type { HealthEntryDto } from '../../../settings-applications/api/remoteAppsApi'
import { groupPermissionsByApp } from '../../../profile/utils/formatUserPermissions'
import styles from './PermissionMatrixTable.module.css'

/** Super-admin capability definitions, grouped by application with zero repetitive rows */
const ADMIN_CAPABILITY_GROUPS = [
  {
    app: 'Host Platform',
    source: 'Host',
    modules: [
      {
        name: 'User Management',
        desc: 'Full authority to create, edit, deactivate, and assign roles to platform users.',
        actions: [
          { verb: 'Manage', tone: 'manage' },
          { verb: 'Create', tone: 'create' },
          { verb: 'Edit', tone: 'edit' },
          { verb: 'Disable', tone: 'disable' },
          { verb: 'Delete', tone: 'delete' },
        ],
      },
      {
        name: 'Role & RBAC Configuration',
        desc: 'Manage system roles, assign application scopes, and fine-tune permission grants.',
        actions: [
          { verb: 'Manage', tone: 'manage' },
          { verb: 'Configure', tone: 'edit' },
          { verb: 'Scopes', tone: 'approve' },
        ],
      },
      {
        name: 'Micro-Frontend Registry',
        desc: 'Register, configure, monitor, and manage Module Federation remote applications.',
        actions: [
          { verb: 'Register', tone: 'register' },
          { verb: 'Edit', tone: 'edit' },
          { verb: 'Disable', tone: 'disable' },
          { verb: 'Monitor', tone: 'view' },
        ],
      },
      {
        name: 'System Security Audit Trail',
        desc: 'Real-time visibility into authentication logs, security events, and administrative actions.',
        actions: [
          { verb: 'View', tone: 'view' },
          { verb: 'Export', tone: 'export' },
          { verb: 'Audit', tone: 'manage' },
        ],
      },
      {
        name: 'Checker & Approval Control',
        desc: 'Full control over maker-checker approval workflows, queues, and status overrides.',
        actions: [
          { verb: 'Approve', tone: 'approve' },
          { verb: 'Reject', tone: 'disable' },
          { verb: 'Override', tone: 'manage' },
        ],
      },
    ],
  },
  {
    app: 'Connected Remote Applications',
    source: 'Remote',
    modules: [
      {
        name: 'All Micro-Frontend Services',
        desc: 'Unrestricted access across all registered remote micro-frontend applications and features.',
        actions: [
          { verb: 'Full Access', tone: 'approve' },
          { verb: 'All Modules', tone: 'manage' },
        ],
      },
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
  /** Flat "featureKey:Capability" strings */
  permissions: string[]
  catalog: PermissionFeatureDto[]
  registryApps: HealthEntryDto[]
  isAdministrator: boolean
  roleName?: string | null
}

/**
 * Enhanced Permission Matrix Table.
 *
 * Designed with zero repetition:
 * - Applications render as clean, distinct Card Sections (never repeated per module or row)
 * - Modules render once per row, grouping all their color-coded capabilities together
 * - Meaningless columns like "Status: Granted" and redundant "Type" columns are removed
 * - Super Administrators receive a polished privileges overview card with module authority breakdowns
 */
export function PermissionMatrixTable({
  permissions,
  catalog,
  registryApps,
  isAdministrator,
  roleName,
}: PermissionMatrixTableProps) {
  const [appFilter, setAppFilter] = useState('')
  const [permSearch, setPermSearch] = useState('')
  const debouncedPermSearch = useDebouncedValue(permSearch, 200)

  const appGroups = useMemo(
    () => groupPermissionsByApp(permissions, catalog, registryApps),
    [permissions, catalog, registryApps],
  )

  const appOptions = useMemo(
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

  // ── Administrator View ──────────────────────────────────────────
  if (isAdministrator) {
    return (
      <div className={styles.permContainer}>
        {/* Administrator privilege banner */}
        <div className={styles.adminBanner}>
          <div className={styles.adminBannerIcon}>
            <Icon.Crown width={20} height={20} />
          </div>
          <div className={styles.adminBannerContent}>
            <div className={styles.adminBannerTitle}>Super Administrator Privileges</div>
            <div className={styles.adminBannerSubtitle}>
              This user has complete, unrestricted administrative access across all host platform services and registered micro-frontend applications.
            </div>
          </div>
          <span className={styles.adminAccessBadge}>
            <Icon.CheckCircle width={13} height={13} />
            Unrestricted
          </span>
        </div>

        {/* Grouped Admin Apps */}
        <div className={styles.appGroupsContainer}>
          {ADMIN_CAPABILITY_GROUPS.map((group) => (
            <div key={group.app} className={styles.appCard}>
              <div className={styles.appCardHeader}>
                <div className={styles.appCardHeaderLeft}>
                  <div className={styles.appIcon}>
                    <Icon.ShieldCheck width={16} height={16} />
                  </div>
                  <div className={styles.appTitleGroup}>
                    <span className={styles.appName}>{group.app}</span>
                    <span className={`${styles.appBadge} ${group.source === 'Host' ? styles.appBadgeCore : styles.appBadgeRemote}`}>
                      {group.source === 'Host' ? 'Core' : 'Remote'}
                    </span>
                  </div>
                </div>
                <div className={styles.appCardHeaderRight}>
                  <span className={styles.appCountBadge}>
                    {group.modules.length} {group.modules.length === 1 ? 'module' : 'modules'}
                  </span>
                </div>
              </div>

              <div className={styles.moduleTableWrap}>
                <table className={styles.moduleTable}>
                  <thead>
                    <tr>
                      <th className={styles.thModule}>MODULE</th>
                      <th className={styles.thCapabilities}>AUTHORITY & ACTIONS</th>
                      <th className={styles.thDescription}>SCOPE</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.modules.map((mod) => (
                      <tr key={mod.name} className={styles.moduleRow}>
                        <td className={styles.tdModule}>
                          <span className={styles.moduleBadge}>{mod.name}</span>
                        </td>
                        <td className={styles.tdCapabilities}>
                          <div className={styles.badgesWrap}>
                            {mod.actions.map((act) => (
                              <span
                                key={act.verb}
                                className={`${styles.verbBadge} ${getVerbClass(act.tone)}`}
                              >
                                {act.verb}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className={styles.tdDescription}>
                          <span className={styles.moduleDescText}>{mod.desc}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      </div>
    )
  }

  // ── No Permissions Assigned ─────────────────────────────────────
  if (permissions.length === 0) {
    return (
      <div className={styles.emptyCard}>
        <div className={styles.emptyIconWrap}>
          <Icon.ShieldCheck width={26} height={26} />
        </div>
        <div className={styles.emptyTitle}>Standard Role Access</div>
        <div className={styles.emptyDesc}>
          Application access is authorized via the assigned role ({roleName || 'Standard User'}). No custom granular permission overrides have been assigned to this account.
        </div>
      </div>
    )
  }

  // ── Granular Permissions View ───────────────────────────────────
  return (
    <div className={styles.permContainer}>
      {/* Polished Toolbar */}
      <div className={styles.toolbarCard}>
        <div className={styles.toolbarLeft}>
          <div className={styles.searchWrap}>
            <Icon.Search width={14} height={14} className={styles.searchIcon} />
            <input
              type="text"
              className={styles.searchInput}
              placeholder="Search modules or actions…"
              value={permSearch}
              onChange={(e) => setPermSearch(e.target.value)}
            />
            {permSearch && (
              <button
                type="button"
                className={styles.clearInputBtn}
                onClick={() => setPermSearch('')}
                aria-label="Clear search"
              >
                <Icon.X width={12} height={12} />
              </button>
            )}
          </div>

          {appOptions.length > 1 && (
            <select
              className={styles.appSelect}
              value={appFilter}
              onChange={(e) => setAppFilter(e.target.value)}
            >
              <option value="">All Applications ({appGroups.length})</option>
              {appOptions.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          )}

          {(permSearch || appFilter) && (
            <button
              type="button"
              className={styles.resetFiltersBtn}
              onClick={() => {
                setPermSearch('')
                setAppFilter('')
              }}
            >
              Reset
            </button>
          )}
        </div>

        <div className={styles.toolbarRight}>
          <span className={styles.statPill}>
            <Icon.ShieldCheck width={13} height={13} />
            <span>{permissions.length} {permissions.length === 1 ? 'Permission' : 'Permissions'}</span>
          </span>
          <span className={styles.statPill}>
            <Icon.Grid width={13} height={13} />
            <span>{appGroups.length} {appGroups.length === 1 ? 'App' : 'Apps'}</span>
          </span>
          {roleName && (
            <span className={`${styles.statPill} ${styles.rolePill}`}>
              <Icon.Crown width={13} height={13} />
              <span>{roleName}</span>
            </span>
          )}
        </div>
      </div>

      {/* Filter match count or empty */}
      {filteredAppGroups.length === 0 ? (
        <div className={styles.emptyCard}>
          <Icon.Search width={24} height={24} />
          <div className={styles.emptyTitle}>No matching permissions</div>
          <div className={styles.emptyDesc}>No permissions or modules matched your search criteria.</div>
          <button
            type="button"
            className={styles.clearFilterBtn}
            onClick={() => { setPermSearch(''); setAppFilter('') }}
          >
            Clear filters
          </button>
        </div>
      ) : (
        <div className={styles.appGroupsContainer}>
          {filteredAppGroups.map((group) => (
            <div key={group.appKey} className={styles.appCard}>
              {/* App Header Band — renders exactly once per application */}
              <div className={styles.appCardHeader}>
                <div className={styles.appCardHeaderLeft}>
                  <div
                    className={`${styles.appIcon} ${group.appSource !== 'Host' ? styles.appIconRemote : ''}`}
                  >
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
                  <div className={styles.appTitleGroup}>
                    <span className={styles.appName}>{group.appName}</span>
                    <span className={`${styles.appBadge} ${group.appSource === 'Host' ? styles.appBadgeCore : styles.appBadgeRemote}`}>
                      {group.appSource === 'Host' ? 'Core' : 'Remote'}
                    </span>
                  </div>
                </div>

                <div className={styles.appCardHeaderRight}>
                  <span className={styles.appCountBadge}>
                    {group.modules.length} {group.modules.length === 1 ? 'module' : 'modules'} · {group.totalCount} {group.totalCount === 1 ? 'capability' : 'capabilities'}
                  </span>
                </div>
              </div>

              {/* Module Table — renders each module once with grouped capability action chips */}
              <div className={styles.moduleTableWrap}>
                <table className={styles.moduleTable}>
                  <thead>
                    <tr>
                      <th className={styles.thModule}>MODULE</th>
                      <th className={styles.thCapabilities}>GRANTED ACTIONS</th>
                      <th className={styles.thDescription}>SCOPE & DESCRIPTION</th>
                    </tr>
                  </thead>
                  <tbody>
                    {group.modules.map((mod) => (
                      <tr key={mod.moduleName} className={styles.moduleRow}>
                        <td className={styles.tdModule}>
                          <span className={styles.moduleBadge}>{mod.moduleName}</span>
                        </td>
                        <td className={styles.tdCapabilities}>
                          <div className={styles.badgesWrap}>
                            {mod.capabilities.map((cap) => (
                              <span
                                key={cap.raw}
                                className={`${styles.verbBadge} ${getVerbClass(cap.tone)}`}
                                title={`${cap.actionTitle}: ${cap.description}`}
                              >
                                {cap.verb}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className={styles.tdDescription}>
                          <span className={styles.moduleDescText} title={mod.capabilities.map(c => `${c.verb}: ${c.description}`).join('\n')}>
                            {mod.capabilities[0]?.description || 'Granted application capabilities.'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
