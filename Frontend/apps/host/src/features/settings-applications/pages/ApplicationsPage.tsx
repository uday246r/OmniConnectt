import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, isSuperAdminOrAdmin } from '../../auth/store/authStore'
import { useSettingsDrawerStore } from '../../../shared/stores/settingsDrawerStore'
import { useNavigationStore } from '../../../shared/stores/navigationStore'
import { useRemoteHealthStore } from '../../../shared/stores/remoteHealthStore'
import { useDebouncedValue } from '../../../shared/hooks/useDebouncedValue'
import { queryKeys } from '../../../shared/query/queryKeys'
import { useLiveRefetchInterval } from '../../../shared/query/invalidationBridge'
import { TOPICS, invalidate } from '../../../shared/stores/invalidationStore'
import { ApiError } from '../../../shared/api/httpClient'
import { toast } from '../../../shared/stores/toastStore'
import { Icon } from '../../../shared/components/Icon/Icon'
import { resolveIcon } from '../../../shared/components/Icon/resolveIcon'
import {
  remoteAppsApi,
  type RemoteAppDto,
  type RemoteAppStatus,
} from '../api/remoteAppsApi'
import { isApprovalPending } from '../../approvals/api/approvalsApi'
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Modal,
  PageHeader,
  Pagination,
  ResponsiveRows,
  RowsPerPage,
  SearchField,
  Select,
  formatDate,
  readStoredPageSize,
  type ResponsiveColumn,
  type SearchFieldSuggestion,
  type SelectOption,
} from '@omniconnect/ui'
import styles from './ApplicationsPage.module.css'

const STATUS_FILTER_OPTIONS: SelectOption[] = [
  { value: 'all', label: 'All Statuses' },
  { value: 'Active', label: 'Active' },
  { value: 'Maintenance', label: 'Maintenance' },
  { value: 'Disabled', label: 'Disabled' },
]

const STATUS_CHANGE_OPTIONS: SelectOption[] = [
  { value: 'Active', label: 'Active' },
  { value: 'Maintenance', label: 'Maintenance' },
  { value: 'Disabled', label: 'Disabled' },
]

export function ApplicationsPage() {
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.accessToken)
  const isAdministrator = useAuthStore((s) => isSuperAdminOrAdmin(s.user))
  const hasCapability = useAuthStore((s) => s.hasCapability)
  const pushLayer = useSettingsDrawerStore((s) => s.pushLayer)
  const queryClient = useQueryClient()
  const refetchInterval = useLiveRefetchInterval()
  const healthEntries = useRemoteHealthStore((s) => s.entries)

  const canRegister =
    isAdministrator ||
    hasCapability('host.settings.applications', 'Register') ||
    hasCapability('host.settings.applications', 'Create')
  const canEdit = isAdministrator || hasCapability('host.settings.applications', 'Edit')
  const canDelete =
    isAdministrator ||
    hasCapability('host.settings.applications', 'Delete') ||
    hasCapability('host.settings.applications', 'Remove')
  const canResync =
    isAdministrator ||
    hasCapability('host.settings.applications', 'Edit') ||
    hasCapability('host.settings.applications', 'Resync')

  const [search, setSearch] = useState('')
  const [statusFilter, setStatusFilter] = useState('all')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => readStoredPageSize('host.applications', 10))

  const [resyncing, setResyncing] = useState(false)
  const [resyncResult, setResyncResult] = useState<string | null>(null)

  // Status Modal State
  const [statusTargetApp, setStatusTargetApp] = useState<RemoteAppDto | null>(null)
  const [newStatus, setNewStatus] = useState<RemoteAppStatus>('Active')
  const [maintenanceMessage, setMaintenanceMessage] = useState('')
  const [updatingStatus, setUpdatingStatus] = useState(false)
  const [statusError, setStatusError] = useState<string | null>(null)

  // Delete Modal State
  const [pendingDelete, setPendingDelete] = useState<RemoteAppDto | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const debouncedSearch = useDebouncedValue(search, 300).trim()

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, statusFilter, pageSize])

  const appsQuery = useQuery({
    queryKey: queryKeys.applications.list({ page, pageSize, search: debouncedSearch || undefined }),
    queryFn: ({ signal }) =>
      remoteAppsApi.list(
        accessToken!,
        { page, pageSize, search: debouncedSearch || undefined },
        signal,
      ),
    enabled: Boolean(accessToken),
    placeholderData: keepPreviousData,
    refetchInterval,
  })

  const summaryQuery = useQuery({
    queryKey: queryKeys.applications.all(),
    queryFn: ({ signal }) => remoteAppsApi.list(accessToken!, { page: 1, pageSize: 100 }, signal),
    enabled: Boolean(accessToken),
    staleTime: 30_000,
  })

  const rawApps = appsQuery.data?.items ?? []
  const total = appsQuery.data?.total ?? 0
  const allApps = summaryQuery.data?.items ?? []

  const totalAppsCount = summaryQuery.data?.total ?? total
  const activeCount = allApps.filter((a) => a.status === 'Active').length
  const maintenanceCount = allApps.filter((a) => a.status === 'Maintenance').length
  const disabledCount = allApps.filter((a) => a.status === 'Disabled').length

  const apps = useMemo(() => {
    if (statusFilter === 'all') return rawApps
    return rawApps.filter((a) => a.status === statusFilter)
  }, [rawApps, statusFilter])

  const appSuggestions: SearchFieldSuggestion[] = useMemo(
    () => rawApps.slice(0, 8).map((a) => ({ id: a.displayName, label: a.displayName })),
    [rawApps],
  )

  async function handleResync() {
    if (!accessToken) return
    setResyncing(true)
    setResyncResult(null)
    try {
      const res = await remoteAppsApi.resyncPermissions(accessToken)
      setResyncResult(`Resynced permissions for ${res.resyncedCount} application(s).`)
      toast.success(`Resynced permissions for ${res.resyncedCount} application(s).`)
      invalidate(TOPICS.applications, TOPICS.approvals, TOPICS.kpis)
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all() })
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not resync permissions.')
    } finally {
      setResyncing(false)
    }
  }

  function handleOpenAdd() {
    navigate('/settings/applications/new')
    pushLayer({ type: 'app-form' })
  }

  function handleOpenEdit(app: RemoteAppDto) {
    navigate(`/settings/applications/${app.id}`)
    pushLayer({ type: 'app-form', appId: app.id })
  }

  function openStatusModal(app: RemoteAppDto) {
    setStatusTargetApp(app)
    setNewStatus(app.status)
    setMaintenanceMessage(app.maintenanceMessage || '')
    setStatusError(null)
  }

  async function handleSaveStatus() {
    if (!accessToken || !statusTargetApp) return
    const appName = statusTargetApp.displayName
    setUpdatingStatus(true)
    setStatusError(null)

    try {
      const result = await remoteAppsApi.updateStatus(
        accessToken,
        statusTargetApp.id,
        newStatus,
        newStatus === 'Maintenance' ? maintenanceMessage.trim() || 'Temporarily down for maintenance.' : null,
      )

      setStatusTargetApp(null)
      if (isApprovalPending(result)) {
        toast.success(result.message)
        return
      }

      toast.success(`Application '${appName}' status updated to ${newStatus}.`)
      void useNavigationStore.getState().fetch(accessToken)
      void useRemoteHealthStore.getState().fetch(accessToken)
      invalidate(TOPICS.applications, TOPICS.approvals, TOPICS.kpis)
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all() })
    } catch (err) {
      setStatusError(err instanceof ApiError ? err.message : 'Could not update status.')
    } finally {
      setUpdatingStatus(false)
    }
  }

  async function handleConfirmDelete() {
    if (!pendingDelete || !accessToken) return
    const deletedName = pendingDelete.displayName
    setDeleting(true)
    setDeleteError(null)

    try {
      const result = await remoteAppsApi.remove(accessToken, pendingDelete.id)
      setPendingDelete(null)
      if (isApprovalPending(result)) {
        toast.success(result.message)
        return
      }

      toast.success(`Application '${deletedName}' removed successfully.`)
      void useNavigationStore.getState().fetch(accessToken)
      void useRemoteHealthStore.getState().fetch(accessToken)
      if (apps.length === 1 && page > 1) {
        setPage((p) => p - 1)
      }
      invalidate(TOPICS.applications, TOPICS.approvals, TOPICS.kpis)
      void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all() })
    } catch (err) {
      setDeleteError(err instanceof ApiError ? err.message : 'Could not remove this application.')
    } finally {
      setDeleting(false)
    }
  }

  const columns: ResponsiveColumn<RemoteAppDto>[] = [
    {
      key: 'displayName',
      label: 'Application',
      priority: 'always',
      render: (app) => {
        const AppIcon = resolveIcon(app.iconKey, Icon.Layers)
        return (
          <div className={styles.appCell}>
            <div className={styles.appIconWrap}>
              <AppIcon width={18} height={18} />
            </div>
            <div className={styles.appDetails}>
              <span className={styles.appName}>{app.displayName}</span>
              <span className={styles.appKey}>{app.key}</span>
            </div>
          </div>
        )
      },
    },
    {
      key: 'manifestUrl',
      label: 'Manifest URL',
      priority: 'high',
      render: (app) => (
        <span className={styles.manifestUrl} title={app.manifestUrl}>
          <Icon.Link width={11} height={11} />
          {app.manifestUrl}
        </span>
      ),
    },
    {
      key: 'health',
      label: 'Health',
      priority: 'high',
      render: (app) => {
        const entry = healthEntries.find((h) => h.key === app.key)
        const health = entry?.health ?? 'Unknown'
        const healthClass =
          health === 'Healthy'
            ? styles.healthHealthy
            : health === 'Unreachable'
            ? styles.healthUnreachable
            : styles.healthUnknown

        return (
          <div className={`${styles.healthBadge} ${healthClass}`} title={entry?.error || undefined}>
            <span className={styles.healthDot} />
            <span>{health}</span>
          </div>
        )
      },
    },
    {
      key: 'status',
      label: 'Status',
      priority: 'always',
      render: (app) => {
        const tone =
          app.status === 'Active'
            ? 'success'
            : app.status === 'Maintenance'
            ? 'warning'
            : 'neutral'

        return (
          <button
            type="button"
            className={styles.statusPillBtn}
            onClick={() => canEdit && openStatusModal(app)}
            disabled={!canEdit}
            title={canEdit ? 'Click to change status' : undefined}
          >
            <Badge tone={tone}>{app.status}</Badge>
          </button>
        )
      },
    },
    {
      key: 'sidebarOrder',
      label: 'Order',
      priority: 'low',
      render: (app) => <span style={{ color: '#64748b', fontSize: '13px' }}>#{app.sidebarOrder}</span>,
    },
    {
      key: 'createdAt',
      label: 'Registered',
      priority: 'low',
      render: (app) => (app.createdAt ? formatDate(app.createdAt) : '—'),
    },
    {
      key: 'actions',
      label: 'Actions',
      priority: 'always',
      align: 'right',
      render: (app) => (
        <div className={styles.actionCell}>
          {canEdit && (
            <button
              type="button"
              className={`${styles.actionIconBtn} ${styles.actionStatus}`}
              onClick={() => openStatusModal(app)}
              title="Change Status"
            >
              <Icon.Sliders width={13} height={13} />
            </button>
          )}
          {canEdit && (
            <button
              type="button"
              className={`${styles.actionIconBtn} ${styles.actionEdit}`}
              onClick={() => handleOpenEdit(app)}
              title="Edit Application"
            >
              <Icon.Edit width={13} height={13} />
            </button>
          )}
          {canDelete && (
            <button
              type="button"
              className={`${styles.actionIconBtn} ${styles.actionDelete}`}
              onClick={() => {
                setDeleteError(null)
                setPendingDelete(app)
              }}
              title="Delete Application"
            >
              <Icon.Trash width={13} height={13} />
            </button>
          )}
        </div>
      ),
    },
  ]

  const summaryValue = (val: number | undefined) => (val === undefined ? '—' : val.toLocaleString())

  return (
    <div className={styles.page}>
      <PageHeader
        title="Applications"
        subtitle="Manage registered microfrontend applications, manifest endpoints, and runtime status."
        actions={
          <div style={{ display: 'flex', gap: '8px' }}>
            {canResync && (
              <Button
                variant="secondary"
                leadingIcon={<Icon.RefreshCw width={15} height={15} />}
                loading={resyncing}
                onClick={handleResync}
              >
                Resync Permissions
              </Button>
            )}
            {canRegister && (
              <Button leadingIcon={<Icon.Plus width={16} height={16} />} onClick={handleOpenAdd}>
                Register Application
              </Button>
            )}
          </div>
        }
      />

      {/* 4 Summary KPI Cards */}
      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconBlue}`}>
            <Icon.Layers width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Total Applications</span>
            <span className={styles.summaryValue}>{summaryValue(totalAppsCount)}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconGreen}`}>
            <Icon.CheckCircle width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Active</span>
            <span className={styles.summaryValue}>{summaryValue(activeCount)}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconAmber}`}>
            <Icon.AlertTriangle width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>In Maintenance</span>
            <span className={styles.summaryValue}>{summaryValue(maintenanceCount)}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconGray}`}>
            <Icon.XCircle width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Disabled</span>
            <span className={styles.summaryValue}>{summaryValue(disabledCount)}</span>
          </div>
        </div>
      </div>

      {appsQuery.error && (
        <div className={styles.errorBanner} role="alert">
          {appsQuery.error instanceof ApiError
            ? appsQuery.error.message
            : 'Could not load applications.'}
        </div>
      )}

      {resyncResult && (
        <div className={styles.successBanner} role="status">
          {resyncResult}
        </div>
      )}

      {/* Table Card */}
      <div className={styles.card}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarSearch}>
            <SearchField
              placeholder="Search applications by name…"
              value={search}
              onValueChange={setSearch}
              suggestions={appSuggestions}
              onSelectSuggestion={(s) => setSearch(s.id)}
              emptyHint="No matching applications."
            />
          </div>

          <div className={styles.filterSelectWrap}>
            <Select
              value={statusFilter}
              options={STATUS_FILTER_OPTIONS}
              onChange={(e) => setStatusFilter(e.target.value)}
            />
          </div>

          <div className={styles.toolbarActions}>
            <RowsPerPage storageKey="host.applications" value={pageSize} onChange={setPageSize} />
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Icon.Activity width={15} height={15} />}
              onClick={() =>
                void queryClient.invalidateQueries({ queryKey: queryKeys.applications.all() })
              }
            >
              Refresh
            </Button>
          </div>
        </div>

        <DataTable
          bare
          reserveHeight
          footer={
            <Pagination
              page={page}
              pageSize={pageSize}
              total={total}
              onPageChange={setPage}
              itemLabel="application"
            />
          }
        >
          <ResponsiveRows
            columns={columns}
            rows={apps}
            rowKey={(a) => a.id}
            loading={appsQuery.isLoading}
            loadingRows={pageSize > 10 ? 10 : pageSize}
            empty={<EmptyState compact title="No applications found matching your criteria." />}
          />
        </DataTable>
      </div>

      {/* Change Status Modal */}
      <Modal
        open={Boolean(statusTargetApp)}
        onClose={() => !updatingStatus && setStatusTargetApp(null)}
        title={`Change Status: ${statusTargetApp?.displayName || ''}`}
      >
        <div className={styles.modalBody}>
          <div className={styles.formGroup}>
            <label className={styles.label}>Application Status</label>
            <Select
              value={newStatus}
              options={STATUS_CHANGE_OPTIONS}
              onChange={(e) => setNewStatus(e.target.value as RemoteAppStatus)}
            />
          </div>

          {newStatus === 'Maintenance' && (
            <div className={styles.formGroup}>
              <label className={styles.label}>Maintenance Message</label>
              <textarea
                className={styles.textarea}
                placeholder="Message shown to users when accessing this application..."
                value={maintenanceMessage}
                onChange={(e) => setMaintenanceMessage(e.target.value)}
              />
            </div>
          )}

          {statusError && (
            <div className={styles.errorBanner} role="alert">
              {statusError}
            </div>
          )}

          <div className={styles.modalActions}>
            <Button
              variant="secondary"
              onClick={() => setStatusTargetApp(null)}
              disabled={updatingStatus}
            >
              Cancel
            </Button>
            <Button variant="primary" loading={updatingStatus} onClick={handleSaveStatus}>
              Save Status
            </Button>
          </div>
        </div>
      </Modal>

      {/* Delete Confirmation Modal */}
      <Modal
        open={Boolean(pendingDelete)}
        onClose={() => !deleting && setPendingDelete(null)}
        title="Delete Application"
      >
        <div className={styles.modalBody}>
          <p className={styles.modalText}>
            Are you sure you want to delete application <strong>&lsquo;{pendingDelete?.displayName}&rsquo;</strong>?
            This will deregister the application and remove its microfrontend route and permissions.
          </p>
          {deleteError && (
            <div className={styles.errorBanner} role="alert">
              {deleteError}
            </div>
          )}
          <div className={styles.modalActions}>
            <Button
              variant="secondary"
              onClick={() => setPendingDelete(null)}
              disabled={deleting}
            >
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={handleConfirmDelete}>
              Delete Application
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
