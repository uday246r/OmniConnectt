import { useEffect, useState } from 'react'
import { useAuthStore } from '../../features/auth/store/authStore'
import { usersApi, type UserListItemDto } from '../../features/settings-users/api/usersApi'
import { rolesApi, type RoleListItemDto } from '../../features/settings-roles/api/rolesApi'
import { isApprovalPending } from '../../features/approvals/api/approvalsApi'
import { asPendingApprovalConflict, type PendingApprovalConflict } from '../../features/approvals/pendingConflict'
import { PendingApprovalDialog } from '../../features/approvals/components/PendingApprovalDialog'
import { useSettingsDrawerStore } from '../../shared/stores/settingsDrawerStore'
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue'
import { Icon } from '../../shared/components/Icon/Icon'
import { SkeletonUserCard } from '../../shared/components/Skeleton'
import { Pagination } from '../../shared/components/Pagination/Pagination'
import { Modal } from '../../shared/components/Modal/Modal'
import { Button } from '../../shared/components/Button/Button'
import { ApiError } from '../../shared/api/httpClient'
import { toast } from '../../shared/stores/toastStore'
import styles from './SettingsUsersTab.module.css'
import { TOPICS, invalidate, useDataRevision } from '../../shared/stores/invalidationStore'

const PAGE_SIZE = 10

export function SettingsUsersTab() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const isAdministrator = Boolean(useAuthStore((s) => s.user)?.isAdministrator)
  const hasCapability = useAuthStore((s) => s.hasCapability)
  // Needed per ROW, not just for the page: the destructive actions below must never be offered on
  // the signed-in user's own account. Previously this component never read the current user's id at
  // all, so an operator saw a live Delete button and a working deactivate toggle on their own row.
  const currentUserId = useAuthStore((s) => s.user?.id)
  const pushLayer = useSettingsDrawerStore((s) => s.pushLayer)
  const dataRevision = useDataRevision(TOPICS.users)

  const canCreate = isAdministrator || hasCapability('host.settings.users', 'Create')
  const canEdit = isAdministrator || hasCapability('host.settings.users', 'Edit')
  const canDelete = isAdministrator || hasCapability('host.settings.users', 'Delete')
  const canDisable = isAdministrator || hasCapability('host.settings.users', 'Disable')

  const [users, setUsers] = useState<UserListItemDto[]>([])
  const [roles, setRoles] = useState<RoleListItemDto[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [selectedRoleId, setSelectedRoleId] = useState<string>('')
  const [selectedStatus, setSelectedStatus] = useState<'all' | 'active' | 'inactive'>('all')
  const [page, setPage] = useState(1)
  const [pendingDelete, setPendingDelete] = useState<UserListItemDto | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [pendingStatusToggle, setPendingStatusToggle] = useState<UserListItemDto | null>(null)
  const [statusUpdating, setStatusUpdating] = useState(false)
  const [approvalConflict, setApprovalConflict] = useState<PendingApprovalConflict | null>(null)

  // Debounced so typing a name doesn't fire one query per keystroke against the user table.
  const debouncedSearch = useDebouncedValue(search, 300)

  // Load available roles for the filter dropdown
  useEffect(() => {
    if (!accessToken) return
    let cancelled = false

    async function loadRoles() {
      try {
        const res = await rolesApi.list(accessToken!, { pageSize: 100 })
        if (!cancelled) setRoles(res.items)
      } catch (err) {
        console.error('Failed to load roles for filter:', err)
      }
    }

    void loadRoles()
    return () => {
      cancelled = true
    }
  }, [accessToken])

  // Load users filtered by search, role, and status (active first)
  useEffect(() => {
    if (!accessToken) return
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const res = await usersApi.list(accessToken!, {
          page,
          pageSize: PAGE_SIZE,
          search: debouncedSearch || undefined,
          roleId: selectedRoleId || undefined,
          isActive: selectedStatus === 'all' ? undefined : selectedStatus === 'active',
        })
        if (cancelled) return
        // Ensure active users always appear first in the list
        const sorted = [...res.items].sort((a, b) => {
          if (a.isActive !== b.isActive) return a.isActive ? -1 : 1
          return (a.name || a.email).localeCompare(b.name || b.email)
        })
        setUsers(sorted)
        setTotal(res.total)
        setError(null)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Could not load users.')
        setUsers([])
        setTotal(0)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [accessToken, debouncedSearch, selectedRoleId, selectedStatus, page, dataRevision])

  // Any change of filter invalidates the page number
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch, selectedRoleId, selectedStatus])

  function handleToggleStatusClick(u: UserListItemDto) {
    if (!canDisable) return
    setPendingStatusToggle(u)
  }

  async function confirmStatusToggle() {
    if (!pendingStatusToggle || !accessToken) return
    const userTarget = pendingStatusToggle
    const willBeActive = !userTarget.isActive
    setStatusUpdating(true)
    try {
      const result = await usersApi.updateStatus(accessToken, userTarget.id, willBeActive)
      setPendingStatusToggle(null)
      if (isApprovalPending(result)) {
        toast.success(result.message)
        return
      }
      toast.success(
        `User '${userTarget.name || userTarget.email}' ${willBeActive ? 'activated' : 'deactivated'} successfully.`
      )
      invalidate(TOPICS.users, TOPICS.approvals)
    } catch (err) {
      setPendingStatusToggle(null)
      // "Already awaiting approval" is not a failure the operator caused — it gets an explanatory
      // dialog naming the in-flight request, not a red banner.
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
    if (!pendingDelete || !accessToken) return
    const userName = pendingDelete.name || pendingDelete.email
    setDeleting(true)
    try {
      const result = await usersApi.remove(accessToken, pendingDelete.id)
      setPendingDelete(null)
      if (isApprovalPending(result)) {
        toast.success(result.message)
        return
      }
      toast.success(`User '${userName}' deleted successfully.`)
      if (users.length === 1 && page > 1) setPage((p) => p - 1)
      else invalidate(TOPICS.users, TOPICS.approvals)
    } catch (err) {
      setPendingDelete(null)
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

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h3 className={styles.title}>Users</h3>
          <p className={styles.subtitle}>Manage platform user accounts and their assigned roles.</p>
        </div>
        {canCreate && (
          <button
            type="button"
            className={styles.createButton}
            onClick={() => pushLayer({ type: 'user-form' })}
          >
            <Icon.Plus width={16} height={16} />
            <span>Add User</span>
          </button>
        )}
      </div>

      {/* Filter Toolbar: Search + Role Filter Dropdown */}
      <div className={styles.filterToolbar}>
        <div className={styles.searchWrap}>
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search users by name or email..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <Icon.Search width={15} height={15} className={styles.searchIcon} />
        </div>

        <div className={styles.roleFilterWrap}>
          <select
            className={styles.roleFilterSelect}
            value={selectedRoleId}
            onChange={(e) => setSelectedRoleId(e.target.value)}
            aria-label="Filter by role"
          >
            <option value="">All Roles</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name} {r.isAdministrator ? '(Admin)' : ''}
              </option>
            ))}
          </select>
          <Icon.ChevronDown width={14} height={14} className={styles.selectChevron} />
        </div>

        <div className={styles.statusFilterWrap}>
          <select
            className={styles.statusFilterSelect}
            value={selectedStatus}
            onChange={(e) => setSelectedStatus(e.target.value as 'all' | 'active' | 'inactive')}
            aria-label="Filter by status"
          >
            <option value="all">All Statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
          <Icon.ChevronDown width={14} height={14} className={styles.selectChevron} />
        </div>
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          {error}
        </div>
      )}

      {/* Users List */}
      <div className={styles.usersList}>
        {loading ? (
          Array.from({ length: 5 }).map((_, i) => (
            <SkeletonUserCard key={i} />
          ))
        ) : users.length > 0 ? (
          users.map((u) => {
            const initial = (u.name || u.email).charAt(0).toUpperCase()
            const isActive = u.isActive
            /*
             * Your own row is not a target for destructive actions.
             *
             * Deleting or deactivating yourself locks you out instantly, and there is no undo an
             * operator can reach afterwards — they can't sign in to reverse it. The server refuses
             * these too (UserAppService); hiding them here means the operator never reaches a dead
             * end, rather than discovering it from a 403. Editing your own row stays available: name,
             * email and phone are legitimately self-serviceable.
             */
            const isSelf = u.id === currentUserId

            return (
              <div key={u.id} className={styles.userCard}>
                <div className={styles.avatarWrap}>
                  <span className={styles.avatarLetter}>{initial}</span>
                </div>

                <div className={styles.userInfo}>
                  <div className={styles.userNameRow}>
                    <span className={styles.userName}>{u.name}</span>
                    <span className={styles.userRoleBadge}>{u.roleName || (u.isAdministrator ? 'Administrator' : 'No Role')}</span>
                  </div>
                  <span className={styles.userEmail}>{u.email}</span>
                </div>

                <div className={styles.userMeta}>
                  <span
                    className={`${isActive ? styles.activeBadge : styles.inactiveBadge} ${
                      canDisable && !isSelf ? styles.clickable : styles.notClickable
                    }`}
                    onClick={() => !isSelf && handleToggleStatusClick(u)}
                    title={
                      isSelf
                        ? 'You cannot change your own account status'
                        : canDisable
                          ? (isActive ? 'Click to deactivate user' : 'Click to activate user')
                          : undefined
                    }
                  >
                    <span className={isActive ? styles.badgeDotGreen : styles.badgeDotGray} />
                    {isActive ? 'Active' : 'Inactive'}
                  </span>

                  {canEdit && (
                    <button
                      type="button"
                      className={styles.editBtn}
                      onClick={() => pushLayer({ type: 'user-form', userId: u.id })}
                      title="Edit User"
                    >
                      <Icon.Edit width={16} height={16} />
                    </button>
                  )}

                  {canDelete && !isSelf && (
                    <button
                      type="button"
                      className={styles.deleteBtn}
                      onClick={() => setPendingDelete(u)}
                      title="Delete User"
                    >
                      <Icon.Trash width={16} height={16} />
                    </button>
                  )}
                </div>
              </div>
            )
          })
        ) : (
          <div className={styles.emptyState}>
            <p>No users found matching the selected filters.</p>
          </div>
        )}
      </div>

      {/*
        Real pagination. The footer used to render a permanently disabled prev/next around a literal
        "1", so with more than one page of users the rest of the directory was unreachable.
      */}
      {total > 0 && (
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} itemLabel="user" />
      )}

      {/* Status Toggle Confirmation Modal */}
      <Modal
        open={Boolean(pendingStatusToggle)}
        title={
          pendingStatusToggle?.isActive
            ? `Deactivate ${pendingStatusToggle?.name || pendingStatusToggle?.email}?`
            : `Activate ${pendingStatusToggle?.name || pendingStatusToggle?.email}?`
        }
        onClose={() => setPendingStatusToggle(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setPendingStatusToggle(null)}>
              Cancel
            </Button>
            <Button
              variant={pendingStatusToggle?.isActive ? 'danger' : 'primary'}
              loading={statusUpdating}
              onClick={confirmStatusToggle}
            >
              {pendingStatusToggle?.isActive ? 'Deactivate User' : 'Activate User'}
            </Button>
          </>
        }
      >
        {pendingStatusToggle?.isActive
          ? `Are you sure you want to deactivate ${pendingStatusToggle?.name || pendingStatusToggle?.email}? They will immediately lose access and will not be able to log in to the platform.`
          : `Are you sure you want to activate ${pendingStatusToggle?.name || pendingStatusToggle?.email}? They will regain access to log in with their assigned roles.`}
      </Modal>

      {/* Delete User Modal */}
      <Modal
        open={Boolean(pendingDelete)}
        title={`Delete ${pendingDelete?.name || pendingDelete?.email}?`}
        onClose={() => setPendingDelete(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={confirmDelete}>
              Delete
            </Button>
          </>
        }
      >
        This removes their access immediately. Their audit log entries are kept, so the record of
        what they did remains intact.
      </Modal>

      <PendingApprovalDialog conflict={approvalConflict} onClose={() => setApprovalConflict(null)} />
    </div>
  )
}
