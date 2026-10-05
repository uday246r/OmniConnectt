import { useEffect, useMemo, useState } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { useAuthStore, isSuperAdminOrAdmin } from '../../auth/store/authStore'
import { useSettingsDrawerStore } from '../../../shared/stores/settingsDrawerStore'
import { useDebouncedValue } from '../../../shared/hooks/useDebouncedValue'
import { queryKeys } from '../../../shared/query/queryKeys'
import { useLiveRefetchInterval } from '../../../shared/query/invalidationBridge'
import { TOPICS, invalidate } from '../../../shared/stores/invalidationStore'
import { ApiError } from '../../../shared/api/httpClient'
import { toast } from '../../../shared/stores/toastStore'
import { Icon } from '../../../shared/components/Icon/Icon'
import { rolesApi, type RoleListItemDto } from '../api/rolesApi'
import { isApprovalPending } from '../../approvals/api/approvalsApi'
import { asPendingApprovalConflict, type PendingApprovalConflict } from '../../approvals/pendingConflict'
import { PendingApprovalDialog } from '../../approvals/components/PendingApprovalDialog'
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
  formatDate,
  readStoredPageSize,
  type ResponsiveColumn,
  type SearchFieldSuggestion,
} from '@omniconnect/ui'
import styles from './RolesPage.module.css'

export function RolesPage() {
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.accessToken)
  const isAdministrator = useAuthStore((s) => isSuperAdminOrAdmin(s.user))
  const hasCapability = useAuthStore((s) => s.hasCapability)
  const currentUserRoleId = useAuthStore((s) => s.user?.roleId)
  const pushLayer = useSettingsDrawerStore((s) => s.pushLayer)
  const queryClient = useQueryClient()
  const refetchInterval = useLiveRefetchInterval()

  const canCreate = isAdministrator || hasCapability('host.settings.roles', 'Create')
  const canEdit = isAdministrator || hasCapability('host.settings.roles', 'Edit')
  const canDelete = isAdministrator || hasCapability('host.settings.roles', 'Delete')

  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pageSize, setPageSize] = useState(() => readStoredPageSize('host.roles', 10))

  const [pendingDelete, setPendingDelete] = useState<RoleListItemDto | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [approvalConflict, setApprovalConflict] = useState<PendingApprovalConflict | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)

  const debouncedSearch = useDebouncedValue(search, 300).trim()

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, pageSize])

  // Paginated and filtered roles list
  const rolesQuery = useQuery({
    queryKey: queryKeys.roles.list({ page, pageSize, search: debouncedSearch || undefined }),
    queryFn: () =>
      rolesApi.list(accessToken!, { page, pageSize, search: debouncedSearch || undefined }),
    enabled: Boolean(accessToken),
    placeholderData: keepPreviousData,
    refetchInterval,
  })

  // Full catalog query for summary metrics
  const summaryQuery = useQuery({
    queryKey: queryKeys.roles.all(),
    queryFn: () => rolesApi.list(accessToken!, { page: 1, pageSize: 100 }),
    enabled: Boolean(accessToken),
    staleTime: 30_000,
  })

  const roles = rolesQuery.data?.items ?? []
  const total = rolesQuery.data?.total ?? 0
  const allRoles = summaryQuery.data?.items ?? []

  const totalRolesCount = summaryQuery.data?.total ?? total
  const systemRolesCount = allRoles.filter((r) => r.isSystemRole).length
  const customRolesCount = Math.max(0, totalRolesCount - systemRolesCount)
  const adminRolesCount = allRoles.filter((r) => r.isAdministrator).length

  const roleSuggestions: SearchFieldSuggestion[] = useMemo(
    () => roles.slice(0, 8).map((r) => ({ id: r.name, label: r.name })),
    [roles],
  )

  async function handleConfirmDelete() {
    if (!pendingDelete || !accessToken) return
    const roleName = pendingDelete.name
    setDeleting(true)
    setDeleteError(null)

    try {
      const result = await rolesApi.remove(accessToken, pendingDelete.id)
      setPendingDelete(null)
      if (isApprovalPending(result)) {
        toast.success(result.message)
        return
      }
      toast.success(`Role '${roleName}' deleted successfully.`)
      if (roles.length === 1 && page > 1) {
        setPage((p) => p - 1)
      }
      invalidate(TOPICS.roles, TOPICS.approvals, TOPICS.kpis)
      void queryClient.invalidateQueries({ queryKey: queryKeys.roles.all() })
    } catch (err) {
      const conflict = asPendingApprovalConflict(err)
      if (conflict) {
        setPendingDelete(null)
        setApprovalConflict(conflict)
        return
      }
      setDeleteError(err instanceof ApiError ? err.message : 'Could not delete this role.')
    } finally {
      setDeleting(false)
    }
  }

  function handleOpenAdd() {
    navigate('/settings/roles/new')
    pushLayer({ type: 'role-form' })
  }

  function handleOpenEdit(role: RoleListItemDto) {
    navigate(`/settings/roles/${role.id}`)
    pushLayer({ type: 'role-form', roleId: role.id })
  }

  const columns: ResponsiveColumn<RoleListItemDto>[] = [
    {
      key: 'name',
      label: 'Role',
      priority: 'always',
      render: (role) => (
        <div className={styles.roleCell}>
          <div className={styles.roleIconWrap}>
            <Icon.ShieldCheck width={18} height={18} />
          </div>
          <div className={styles.roleDetails}>
            <div className={styles.roleNameRow}>
              <span className={styles.roleName}>{role.name}</span>
              {role.isAdministrator && <span className={styles.adminBadge}>Administrator</span>}
              {role.isSystemRole && <span className={styles.systemBadge}>System</span>}
            </div>
          </div>
        </div>
      ),
    },
    {
      key: 'description',
      label: 'Description',
      priority: 'high',
      render: (role) => (
        <span className={styles.descriptionCell} title={role.description || ''}>
          {role.description || (role.isAdministrator ? 'Full platform administrator access' : 'Custom defined role')}
        </span>
      ),
    },
    {
      key: 'type',
      label: 'Type',
      priority: 'high',
      render: (role) => (
        <Badge tone={role.isSystemRole ? 'primary' : 'success'}>
          {role.isSystemRole ? 'System' : 'Custom'}
        </Badge>
      ),
    },
    {
      key: 'usersCount',
      label: 'Assigned Users',
      priority: 'low',
      render: (role) => (
        <button
          type="button"
          className={styles.usersCountBtn}
          onClick={() => {
            navigate(`/settings/roles/${role.id}`)
            pushLayer({ type: 'role-form', roleId: role.id, initialTab: 'users' })
          }}
          title={`View and manage members assigned to ${role.name}`}
        >
          <Icon.Users width={12} height={12} />
          <span>{role.usersCount} users</span>
        </button>
      ),
    },
    {
      key: 'permissions',
      label: 'Capabilities',
      priority: 'low',
      render: (role) =>
        role.isAdministrator ? (
          <Badge tone="warning">All Capabilities</Badge>
        ) : (
          <span className={styles.permCount}>{role.permissionsCount} capabilities</span>
        ),
    },
    {
      key: 'createdAt',
      label: 'Created',
      priority: 'low',
      render: (role) => (role.createdAt ? formatDate(role.createdAt) : '—'),
    },
    {
      key: 'actions',
      label: 'Actions',
      priority: 'always',
      align: 'right',
      render: (role) => {
        const allowEdit = canEdit && (!role.isAdministrator || isAdministrator)
        const allowDelete =
          canDelete &&
          !role.isSystemRole &&
          role.id !== currentUserRoleId &&
          (!role.isAdministrator || isAdministrator)

        return (
          <div className={styles.actionCell}>
            {allowEdit && (
              <button
                type="button"
                className={`${styles.actionIconBtn} ${styles.actionEdit}`}
                onClick={() => handleOpenEdit(role)}
                title="Edit role"
              >
                <Icon.Edit width={13} height={13} />
              </button>
            )}
            {allowDelete && (
              <button
                type="button"
                className={`${styles.actionIconBtn} ${styles.actionDelete}`}
                onClick={() => {
                  setDeleteError(null)
                  setPendingDelete(role)
                }}
                title="Delete role"
              >
                <Icon.Trash width={13} height={13} />
              </button>
            )}
          </div>
        )
      },
    },
  ]

  const summaryValue = (val: number | undefined) => (val === undefined ? '—' : val.toLocaleString())

  return (
    <div className={styles.page}>
      <PageHeader
        title="Roles & Permissions"
        subtitle="Define roles and configure granular permissions across platform features."
        actions={
          canCreate && (
            <Button leadingIcon={<Icon.Plus width={16} height={16} />} onClick={handleOpenAdd}>
              Add Role
            </Button>
          )
        }
      />

      {/* 4 Summary KPI Cards */}
      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconBlue}`}>
            <Icon.Shield width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Total Roles</span>
            <span className={styles.summaryValue}>{summaryValue(totalRolesCount)}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconPurple}`}>
            <Icon.Lock width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>System Roles</span>
            <span className={styles.summaryValue}>{summaryValue(systemRolesCount)}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconGreen}`}>
            <Icon.Sliders width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Custom Roles</span>
            <span className={styles.summaryValue}>{summaryValue(customRolesCount)}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconAmber}`}>
            <Icon.Crown width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Administrators</span>
            <span className={styles.summaryValue}>{summaryValue(adminRolesCount)}</span>
          </div>
        </div>
      </div>

      {rolesQuery.error && (
        <div className={styles.errorBanner} role="alert">
          {rolesQuery.error instanceof ApiError ? rolesQuery.error.message : 'Could not load roles.'}
        </div>
      )}

      {/* Table Card */}
      <div className={styles.card}>
        <div className={styles.toolbar}>
          <div className={styles.toolbarSearch}>
            <SearchField
              placeholder="Search roles by name…"
              value={search}
              onValueChange={setSearch}
              suggestions={roleSuggestions}
              onSelectSuggestion={(s) => setSearch(s.id)}
              emptyHint="No matching roles."
            />
          </div>
          <div className={styles.toolbarActions}>
            <RowsPerPage storageKey="host.roles" value={pageSize} onChange={setPageSize} />
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Icon.Activity width={15} height={15} />}
              onClick={() => void queryClient.invalidateQueries({ queryKey: queryKeys.roles.all() })}
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
              itemLabel="role"
            />
          }
        >
          <ResponsiveRows
            columns={columns}
            rows={roles}
            rowKey={(r) => r.id}
            loading={rolesQuery.isLoading}
            loadingRows={pageSize > 10 ? 10 : pageSize}
            empty={<EmptyState compact title="No roles found matching your search." />}
          />
        </DataTable>
      </div>

      {/* Delete Confirmation Modal */}
      <Modal
        open={Boolean(pendingDelete)}
        onClose={() => !deleting && setPendingDelete(null)}
        title="Delete Role"
      >
        <div className={styles.modalBody}>
          <p className={styles.modalText}>
            Are you sure you want to delete the role <strong>&lsquo;{pendingDelete?.name}&rsquo;</strong>?
            {pendingDelete && pendingDelete.usersCount > 0 && (
              <> This role currently has <strong>{pendingDelete.usersCount} user(s)</strong> assigned.</>
            )}
          </p>
          {deleteError && (
            <div className={styles.errorBanner} role="alert">
              {deleteError}
            </div>
          )}
          <div className={styles.modalActions}>
            <Button variant="secondary" onClick={() => setPendingDelete(null)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={handleConfirmDelete}>
              Delete Role
            </Button>
          </div>
        </div>
      </Modal>

      {/* Pending Approval Conflict Dialog */}
      <PendingApprovalDialog
        conflict={approvalConflict}
        onClose={() => setApprovalConflict(null)}
      />
    </div>
  )
}
