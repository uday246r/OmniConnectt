import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore } from '../../auth/store/authStore'
import { useModuleRegistryStore } from '../../../shared/stores/moduleRegistryStore'
import { useSettingsDrawerStore } from '../../../shared/stores/settingsDrawerStore'
import { TOPICS, invalidate, useDataRevision } from '../../../shared/stores/invalidationStore'
import { ApiError } from '../../../shared/api/httpClient'
import { Icon } from '../../../shared/components/Icon/Icon'
import { toast } from '../../../shared/stores/toastStore'
import { usersApi, type UserDetailDto } from '../api/usersApi'
import { userSchemaApi } from '../../settings-user-fields/api/userSchemaApi'
import type { FieldDefinition } from '@omniremit/ui/validation'
import { rolesApi, type RoleDetailDto } from '../../settings-roles/api/rolesApi'
import { isApprovalPending } from '../../approvals/api/approvalsApi'
import { asPendingApprovalConflict, type PendingApprovalConflict } from '../../approvals/pendingConflict'
import { PendingApprovalDialog } from '../../approvals/components/PendingApprovalDialog'
import { auditLogsApi, type AuditLogDto } from '../../system-audit-logs/api/auditLogsApi'
import { formatActionLabel, actionBadgeTone, formatIpv4 } from '../../system-audit-logs/utils/auditLogFormatting'
import { AuditLogDetailDrawer } from '../../system-audit-logs/components/AuditLogDetailDrawer/AuditLogDetailDrawer'
import { usePermissionCatalog } from '../hooks/usePermissionCatalog'
import { computeEffectivePermissions } from '../utils/effectivePermissions'
import { PermissionMatrixTable } from '../components/PermissionMatrixTable/PermissionMatrixTable'
import { useDebouncedValue } from '../../../shared/hooks/useDebouncedValue'
import { DateTimeRangeFilter, type DateTimeRangeValue } from '../../../shared/components/DateTimeRangeFilter/DateTimeRangeFilter'
import {
  Badge,
  Button,
  ColumnFilter,
  DataTable,
  DetailField,
  DetailGrid,
  DetailSection,
  DetailSections,
  EMPTY_VALUE,
  EmptyState,
  FilterBar,
  Modal,
  PageHeader,
  Pagination,
  ResponsiveRows,
  RowAction,
  Tabs,
  TabPanel,
  formatAuditTimestamp,
  formatDateTime,
  type ActiveFilter,
  type ColumnFilterOption,
  type ResponsiveColumn,
} from '@omniremit/ui'
import styles from './UserDetailPage.module.css'

const LOGS_POOL_SIZE = 200
const LOGS_PAGE_SIZE = 10
type DetailTab = 'profile' | 'permissions' | 'activity'

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.accessToken)
  const isAdministrator = Boolean(useAuthStore((s) => s.user)?.isAdministrator)
  const hasCapability = useAuthStore((s) => s.hasCapability)
  const currentUserId = useAuthStore((s) => s.user?.id)
  const registryApps = useModuleRegistryStore((s) => s.apps)
  const pushLayer = useSettingsDrawerStore((s) => s.pushLayer)
  const dataRevision = useDataRevision(TOPICS.users)
  const { catalog } = usePermissionCatalog()

  const canEdit = isAdministrator || hasCapability('host.settings.users', 'Edit')
  const canDelete = isAdministrator || hasCapability('host.settings.users', 'Delete')
  const canDisable = isAdministrator || hasCapability('host.settings.users', 'Disable')
  const canExportAuditLogs = isAdministrator || hasCapability('host.system.audit-logs', 'Export')

  const [detail, setDetail] = useState<UserDetailDto | null>(null)
  const [roleDetail, setRoleDetail] = useState<RoleDetailDto | null>(null)
  // Labels for any admin-defined custom field (Aadhar Number, etc.) so the Profile tab can show them
  // by name rather than raw dict keys — detail.customFields only carries fieldKey -> value.
  const [customFieldDefs, setCustomFieldDefs] = useState<FieldDefinition[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<DetailTab>('profile')

  const [pendingStatusToggle, setPendingStatusToggle] = useState(false)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [approvalConflict, setApprovalConflict] = useState<PendingApprovalConflict | null>(null)

  const [logsPool, setLogsPool] = useState<AuditLogDto[] | null>(null)
  const [logsPage, setLogsPage] = useState(1)
  const [actionFilter, setActionFilter] = useState('')
  const [resultFilter, setResultFilter] = useState('')
  const [appFilter, setAppFilter] = useState('')
  const [entitySearch, setEntitySearch] = useState('')
  const [timeRange, setTimeRange] = useState<DateTimeRangeValue>({})
  const [viewingLog, setViewingLog] = useState<AuditLogDto | null>(null)
  const [exporting, setExporting] = useState(false)

  const debouncedEntitySearch = useDebouncedValue(entitySearch, 300)

  useEffect(() => {
    if (!accessToken || !id) return
    let cancelled = false
    setLoading(true)
    usersApi
      .get(accessToken, id)
      .then((res) => {
        if (cancelled) return
        setDetail(res)
        setError(null)
        if (!res.isAdministrator && res.roleId) {
          rolesApi
            .get(accessToken, res.roleId)
            .then((r) => {
              if (!cancelled) setRoleDetail(r)
            })
            .catch(() => {
              if (!cancelled) setRoleDetail(null)
            })
        } else {
          setRoleDetail(null)
        }
      })
      .catch((err) => {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Could not load this user.')
        setDetail(null)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [accessToken, id, dataRevision])

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false
    userSchemaApi
      .get(accessToken)
      .then((res) => {
        if (cancelled) return
        setCustomFieldDefs(res.fields.filter((f) => !f.core).sort((a, b) => a.order - b.order))
      })
      .catch(() => {
        if (!cancelled) setCustomFieldDefs([])
      })
    return () => {
      cancelled = true
    }
  }, [accessToken])

  // A bounded pool (200), not this user's whole history — matching the Users list. Actor and date
  // range are narrow enough to push to the server; action/result/entity refine further client-side,
  // with their own options drawn from this same pool rather than a separate lookup.
  useEffect(() => {
    if (!accessToken || !id || tab !== 'activity') return
    let cancelled = false
    setLogsPool(null)
    auditLogsApi
      .list(accessToken, {
        actorUserId: id,
        page: 1,
        pageSize: LOGS_POOL_SIZE,
        sortDir: 'desc',
        from: timeRange.from,
        to: timeRange.to,
      })
      .then((res) => {
        if (!cancelled) setLogsPool(res.items)
      })
      .catch(() => {
        if (!cancelled) setLogsPool([])
      })
    return () => {
      cancelled = true
    }
  }, [accessToken, id, tab, timeRange, dataRevision])

  useEffect(() => {
    setLogsPage(1)
  }, [actionFilter, resultFilter, appFilter, debouncedEntitySearch, timeRange])

  const actionOptions: ColumnFilterOption[] = useMemo(() => {
    if (!logsPool) return []
    const seen = new Map<string, string>()
    for (const l of logsPool) {
      if (!seen.has(l.action)) seen.set(l.action, formatActionLabel(l.action))
    }
    return [...seen.entries()]
      .sort((a, b) => a[1].localeCompare(b[1]))
      .map(([value, label]) => ({ value, label }))
  }, [logsPool])

  const appOptions: ColumnFilterOption[] = useMemo(() => {
    if (!logsPool) return []
    const seen = new Set<string>()
    for (const l of logsPool) {
      const app = l.sourceApplication || l.serviceName
      if (app) seen.add(app)
    }
    return [...seen]
      .sort((a, b) => a.localeCompare(b))
      .map((value) => ({ value, label: value }))
  }, [logsPool])

  const RESULT_OPTIONS: ColumnFilterOption[] = [
    { value: 'Success', label: 'Success' },
    { value: 'Failure', label: 'Failure' },
  ]

  /*
   * Recommendations for the Entity column, drawn from the same pool the table renders — so the
   * operator is only ever offered a record that is genuinely in this user's log, and typing costs
   * no request. Qualified by entity type, since two different records can share a display name.
   */
  const entityPool = useMemo(
    () =>
      (logsPool ?? []).map((l) => ({
        value: l.entityLabel ?? l.entityType ?? '',
        meta: l.entityLabel && l.entityType ? l.entityType : undefined,
      })),
    [logsPool],
  )

  const visibleLogs = useMemo(() => {
    if (!logsPool) return null
    const needle = debouncedEntitySearch.trim().toLowerCase()
    return logsPool.filter((l) => {
      if (actionFilter && l.action !== actionFilter) return false
      if (resultFilter && l.result !== resultFilter) return false
      if (appFilter && (l.sourceApplication || l.serviceName) !== appFilter) return false
      if (needle && !(l.entityLabel ?? l.entityType ?? '').toLowerCase().includes(needle)) return false
      return true
    })
  }, [logsPool, actionFilter, resultFilter, appFilter, debouncedEntitySearch])

  const logsTotal = visibleLogs?.length ?? 0
  const pagedLogs = useMemo(() => {
    if (!visibleLogs) return []
    const start = (logsPage - 1) * LOGS_PAGE_SIZE
    return visibleLogs.slice(start, start + LOGS_PAGE_SIZE)
  }, [visibleLogs, logsPage])

  const activityFilters: ActiveFilter[] = [
    actionFilter && {
      key: 'action',
      label: 'Action',
      value: formatActionLabel(actionFilter),
      onRemove: () => setActionFilter(''),
    },
    appFilter && {
      key: 'app',
      label: 'Application',
      value: appFilter,
      onRemove: () => setAppFilter(''),
    },
    resultFilter && { key: 'result', label: 'Result', value: resultFilter, onRemove: () => setResultFilter('') },
    debouncedEntitySearch && {
      key: 'entity',
      label: 'Entity',
      value: `"${debouncedEntitySearch}"`,
      onRemove: () => setEntitySearch(''),
    },
    (timeRange.from || timeRange.to) && {
      key: 'time',
      label: 'Time',
      value: `${timeRange.from ? formatDateTime(timeRange.from) : '…'} → ${timeRange.to ? formatDateTime(timeRange.to) : '…'}`,
      onRemove: () => setTimeRange({}),
    },
  ].filter(Boolean) as ActiveFilter[]

  async function handleExportActivity() {
    if (!accessToken || !detail) return
    setExporting(true)
    try {
      await auditLogsApi.exportCsv(accessToken, {
        actorUserId: detail.id,
        from: timeRange.from,
        to: timeRange.to,
        action: actionFilter || undefined,
        result: (resultFilter as any) || undefined,
        sourceApplication: appFilter || undefined,
      })
      toast.success('Audit log report exported successfully.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Failed to export audit report.')
    } finally {
      setExporting(false)
    }
  }

  const effectivePermissions = useMemo(() => {
    if (!detail || detail.isAdministrator) return []
    return computeEffectivePermissions(roleDetail?.permissions, detail.permissionOverrides)
  }, [detail, roleDetail])

  const isSelf = detail?.id === currentUserId

  async function confirmStatusToggle() {
    if (!detail || !accessToken) return
    const willBeActive = !detail.isActive
    setStatusUpdating(true)
    try {
      const result = await usersApi.updateStatus(accessToken, detail.id, willBeActive)
      setPendingStatusToggle(false)
      if (isApprovalPending(result)) {
        toast.success(result.message)
        return
      }
      toast.success(`User '${detail.name || detail.email}' ${willBeActive ? 'activated' : 'deactivated'} successfully.`)
      invalidate(TOPICS.users, TOPICS.approvals, TOPICS.kpis)
    } catch (err) {
      setPendingStatusToggle(false)
      const conflict = asPendingApprovalConflict(err)
      if (conflict) {
        setApprovalConflict(conflict)
        return
      }
      setError(err instanceof ApiError ? err.message : 'Could not update this user status.')
    } finally {
      setStatusUpdating(false)
    }
  }

  async function confirmDelete() {
    if (!detail || !accessToken) return
    const userName = detail.name || detail.email
    setDeleting(true)
    try {
      const result = await usersApi.remove(accessToken, detail.id)
      setPendingDelete(false)
      if (isApprovalPending(result)) {
        toast.success(result.message)
        return
      }
      toast.success(`User '${userName}' deleted successfully.`)
      invalidate(TOPICS.users, TOPICS.approvals, TOPICS.kpis)
      navigate('/settings/users')
    } catch (err) {
      setPendingDelete(false)
      const conflict = asPendingApprovalConflict(err)
      if (conflict) {
        setApprovalConflict(conflict)
        return
      }
      setError(err instanceof ApiError ? err.message : 'Could not delete this user.')
    } finally {
      setDeleting(false)
    }
  }

  const logColumns: ResponsiveColumn<AuditLogDto>[] = [
    {
      key: 'time',
      label: 'Time',
      priority: 'always',
      header: <DateTimeRangeFilter label="Time" value={timeRange} onChange={setTimeRange} />,
      render: (l) => formatAuditTimestamp(l.occurredAt),
    },
    {
      key: 'action',
      label: 'Action',
      priority: 'always',
      header: (
        <ColumnFilter
          label="Action"
          value={actionFilter}
          onChange={setActionFilter}
          options={actionOptions}
          allLabel="All Actions"
          searchable={actionOptions.length > 6}
        />
      ),
      render: (l) => <Badge tone={actionBadgeTone(l.action)}>{formatActionLabel(l.action)}</Badge>,
    },
    {
      key: 'app',
      label: 'Application',
      priority: 'high',
      header: (
        <ColumnFilter
          label="Application"
          value={appFilter}
          onChange={setAppFilter}
          options={appOptions}
          allLabel="All Apps"
          searchable={appOptions.length > 6}
        />
      ),
      render: (l) => <Badge tone="neutral">{l.sourceApplication || l.serviceName}</Badge>,
    },
    {
      key: 'entity',
      label: 'Entity',
      priority: 'high',
      header: (
        <ColumnFilter
          label="Entity"
          value={entitySearch}
          onChange={setEntitySearch}
          options={[]}
          freeText
          filterType="text"
          searchPlaceholder="Search by affected record..."
          suggestFrom={entityPool}
          emptyHint="No matching record in this log."
        />
      ),
      // Human-readable, never a raw id: the record's own name carries the same meaning a GUID would,
      // qualified by its type when the name alone would be ambiguous (e.g. "Ashok · User").
      render: (l) =>
        l.entityLabel ? (
          <span>
            {l.entityLabel}
            {l.entityType && <span className={styles.entityQualifier}> · {l.entityType}</span>}
          </span>
        ) : (
          l.entityType ?? EMPTY_VALUE
        ),
    },
    {
      key: 'result',
      label: 'Result',
      priority: 'always',
      header: (
        <ColumnFilter
          label="Result"
          value={resultFilter}
          onChange={setResultFilter}
          options={RESULT_OPTIONS}
          allLabel="All Results"
          searchable={false}
        />
      ),
      render: (l) => <Badge tone={l.result === 'Success' ? 'success' : 'danger'}>{l.result}</Badge>,
    },
    { key: 'ip', label: 'Source IP', priority: 'low', render: (l) => formatIpv4(l.sourceIp) },
    {
      key: 'actions',
      label: '',
      priority: 'always',
      align: 'right',
      render: (l) => <RowAction onClick={() => setViewingLog(l)}>View</RowAction>,
    },
  ]

  if (loading && !detail) {
    return (
      <div className={styles.page}>
        <div className={styles.loadingState}>Loading user…</div>
      </div>
    )
  }

  if (!detail) {
    return (
      <div className={styles.page}>
        <EmptyState
          title="User not found"
          description={error ?? "This user doesn't exist or you don't have access to view it."}
          action={<Button onClick={() => navigate('/settings/users')}>Back to Users</Button>}
        />
      </div>
    )
  }

  return (
    <div className={styles.page}>
      <PageHeader
        icon={<Icon.User width={22} height={22} />}
        title={[detail.salutation, detail.name].filter(Boolean).join(' ')}
        subtitle={detail.email}
        pill={
          <>
            <span className={styles.headerChip}>
              <Icon.ShieldCheck width={12} height={12} />
              {detail.roleName ?? (detail.isAdministrator ? 'Administrator' : 'No Role')}
            </span>
            <span className={styles.headerChipDivider} />
            <span className={styles.headerChip}>
              <span className={`${styles.headerChipDot} ${detail.isActive ? styles.headerChipDotActive : styles.headerChipDotInactive}`} />
              {detail.isActive ? 'Active' : 'Inactive'}
            </span>
          </>
        }
        actions={
          <div className={styles.headerActions}>
            <Button variant="secondary" leadingIcon={<Icon.ChevronLeft width={15} height={15} />} onClick={() => navigate('/settings/users')}>
              Back to Users
            </Button>
            {canEdit && (
              <Button leadingIcon={<Icon.Edit width={15} height={15} />} onClick={() => pushLayer({ type: 'user-form', userId: detail.id })}>
                Edit
              </Button>
            )}
            {canDisable && !isSelf && (
              <Button variant="secondary" onClick={() => setPendingStatusToggle(true)}>
                {detail.isActive ? 'Deactivate' : 'Activate'}
              </Button>
            )}
            {canDelete && !isSelf && (
              <Button variant="danger" leadingIcon={<Icon.Trash width={15} height={15} />} onClick={() => setPendingDelete(true)}>
                Delete
              </Button>
            )}
          </div>
        }
      />

      {error && (
        <div className={styles.errorBanner} role="alert">
          {error}
        </div>
      )}

      {/* Tab bar — same bordered, shadowed pill-tab card as Approval Center's and Audit Logs'
          "Pending / Processed / All Requests" row, not a bare Tabs strip floating on the page. */}
      <div className={styles.navBar}>
        <Tabs
          id="user-detail-tabs"
          variant="pill"
          activeKey={tab}
          onChange={(key) => setTab(key as DetailTab)}
          tabs={[
            { key: 'profile', label: 'Profile' },
            { key: 'permissions', label: 'Permissions', suffix: !detail.isAdministrator ? <Badge tone="neutral">{effectivePermissions.length}</Badge> : undefined },
            { key: 'activity', label: 'Audit Log' },
          ]}
        />
      </div>

      <TabPanel id="user-detail-tabs" tabId="profile" active={tab === 'profile'}>
        <DetailSections>
          <DetailSection title="Identity">
            <DetailGrid>
              <DetailField label="Salutation">{detail.salutation || EMPTY_VALUE}</DetailField>
              <DetailField label="Full Name" icon={<Icon.User width={15} height={15} />}>{detail.name}</DetailField>
              <DetailField label="Email" icon={<Icon.Mail width={15} height={15} />}>{detail.email}</DetailField>
              <DetailField label="Phone" mono>{detail.phoneNumber}</DetailField>
              <DetailField label="Auth Provider">{detail.authProvider}</DetailField>
            </DetailGrid>
          </DetailSection>
          {customFieldDefs.length > 0 && (
            <DetailSection title="Custom Fields">
              <DetailGrid>
                {customFieldDefs.map((f) => (
                  <DetailField key={f.key} label={f.label}>
                    {detail.customFields?.[f.key] || EMPTY_VALUE}
                  </DetailField>
                ))}
              </DetailGrid>
            </DetailSection>
          )}
          <DetailSection title="Access">
            <DetailGrid>
              <DetailField label="Role" icon={<Icon.ShieldCheck width={15} height={15} />}>{detail.roleName ?? (detail.isAdministrator ? 'Administrator' : 'No Role')}</DetailField>
              <DetailField label="Status">{detail.isActive ? 'Active' : 'Inactive'}</DetailField>
              <DetailField label="Must Change Password">{detail.mustChangePassword ? 'Yes' : 'No'}</DetailField>
              <DetailField label="Last Login" icon={<Icon.Clock width={15} height={15} />}>{formatDateTime(detail.lastLoginAt)}</DetailField>
              <DetailField label="Created" icon={<Icon.Clock width={15} height={15} />}>{formatDateTime(detail.createdAt)}</DetailField>
              <DetailField label="Updated" icon={<Icon.Clock width={15} height={15} />}>{formatDateTime(detail.updatedAt)}</DetailField>
            </DetailGrid>
          </DetailSection>
        </DetailSections>
      </TabPanel>

      <TabPanel id="user-detail-tabs" tabId="permissions" active={tab === 'permissions'}>
        <PermissionMatrixTable
          permissions={effectivePermissions}
          catalog={catalog}
          registryApps={registryApps}
          isAdministrator={detail.isAdministrator}
          roleName={detail.roleName}
        />
      </TabPanel>

      <TabPanel id="user-detail-tabs" tabId="activity" active={tab === 'activity'}>
        <div className={styles.activityToolbar}>
          {canExportAuditLogs && (
            <Button
              variant="secondary"
              leadingIcon={<Icon.Download width={15} height={15} />}
              loading={exporting}
              onClick={handleExportActivity}
            >
              Export Report
            </Button>
          )}
        </div>
        <FilterBar
          filters={activityFilters}
          onClearAll={() => {
            setActionFilter('')
            setResultFilter('')
            setAppFilter('')
            setEntitySearch('')
            setTimeRange({})
          }}
        />
        <DataTable reserveHeight footer={<Pagination page={logsPage} pageSize={LOGS_PAGE_SIZE} total={logsTotal} onPageChange={setLogsPage} itemLabel="event" />}>
          <ResponsiveRows
            columns={logColumns}
            rows={pagedLogs}
            rowKey={(l) => l.id}
            loading={logsPool === null}
            loadingRows={LOGS_PAGE_SIZE}
            empty={<EmptyState compact title="No activity found matching the selected filters." />}
          />
        </DataTable>
      </TabPanel>

      <Modal
        open={pendingStatusToggle}
        title={detail.isActive ? `Deactivate ${detail.name || detail.email}?` : `Activate ${detail.name || detail.email}?`}
        onClose={() => setPendingStatusToggle(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setPendingStatusToggle(false)}>
              Cancel
            </Button>
            <Button variant={detail.isActive ? 'danger' : 'primary'} loading={statusUpdating} onClick={confirmStatusToggle}>
              {detail.isActive ? 'Deactivate User' : 'Activate User'}
            </Button>
          </>
        }
      >
        {detail.isActive
          ? `Are you sure you want to deactivate ${detail.name || detail.email}? They will immediately lose access and will not be able to log in to the platform.`
          : `Are you sure you want to activate ${detail.name || detail.email}? They will regain access to log in with their assigned roles.`}
      </Modal>

      <Modal
        open={pendingDelete}
        title={`Delete ${detail.name || detail.email}?`}
        onClose={() => setPendingDelete(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(false)}>
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={confirmDelete}>
              Delete
            </Button>
          </>
        }
      >
        This removes their access immediately. Their audit log entries are kept, so the record of what they did remains intact.
      </Modal>

      <PendingApprovalDialog conflict={approvalConflict} onClose={() => setApprovalConflict(null)} />

      {viewingLog && (
        <AuditLogDetailDrawer
          log={viewingLog}
          accessToken={accessToken}
          onClose={() => setViewingLog(null)}
          onViewRelated={(cid) => navigate(`/system/audit-logs?correlationId=${encodeURIComponent(cid)}`)}
        />
      )}
    </div>
  )
}
