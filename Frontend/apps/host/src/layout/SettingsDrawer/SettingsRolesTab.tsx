import { useEffect, useMemo, useState } from 'react'
import { useAuthStore } from '../../features/auth/store/authStore'
import { rolesApi, type RoleListItemDto } from '../../features/settings-roles/api/rolesApi'
import { isApprovalPending } from '../../features/approvals/api/approvalsApi'
import { asPendingApprovalConflict, type PendingApprovalConflict } from '../../features/approvals/pendingConflict'
import { PendingApprovalDialog } from '../../features/approvals/components/PendingApprovalDialog'
import { useSettingsDrawerStore } from '../../shared/stores/settingsDrawerStore'
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue'
import { Icon } from '../../shared/components/Icon/Icon'
import { SkeletonRoleCard } from '../../shared/components/Skeleton'
import { ApiError } from '../../shared/api/httpClient'
import { toast } from '../../shared/stores/toastStore'
import styles from './SettingsRolesTab.module.css'
import { TOPICS, invalidate, useDataRevision } from '../../shared/stores/invalidationStore'
import { Button, EmptyState, Modal, Pagination, SearchField, type SearchFieldSuggestion } from '@omniconnect/ui'

const PAGE_SIZE = 10

export function SettingsRolesTab() {
  const accessToken = useAuthStore((s) => s.accessToken)
  // A token refresh must not re-run a load (and reset what the user is editing) — only its first arrival.
  const hasAccessToken = Boolean(accessToken)
  const isAdministrator = Boolean(useAuthStore((s) => s.user)?.isAdministrator)
  const hasCapability = useAuthStore((s) => s.hasCapability)
  // The role the signed-in user currently holds — deleting it would strip their own access, and the
  // server refuses it. Previously this component never read it, so the Delete button appeared on the
  // operator's own role and only failed once clicked.
  const currentUserRoleId = useAuthStore((s) => s.user?.roleId)
  const pushLayer = useSettingsDrawerStore((s) => s.pushLayer)
  // Bumped by every form layer that saves, so closing an editor refreshes this list.
  const dataRevision = useDataRevision(TOPICS.roles)

  const canCreate = isAdministrator || hasCapability('host.settings.roles', 'Create')
  const canEdit = isAdministrator || hasCapability('host.settings.roles', 'Edit')
  const canDelete = isAdministrator || hasCapability('host.settings.roles', 'Delete')

  const [roles, setRoles] = useState<RoleListItemDto[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pendingDelete, setPendingDelete] = useState<RoleListItemDto | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [approvalConflict, setApprovalConflict] = useState<PendingApprovalConflict | null>(null)

  // Every keystroke previously fired its own request. On a large directory that is a request storm
  // against the database for results the operator never sees.
  const debouncedSearch = useDebouncedValue(search, 300)

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const res = await rolesApi.list(accessToken!, {
          page,
          pageSize: PAGE_SIZE,
          search: debouncedSearch || undefined,
        })
        if (cancelled) return
        setRoles(res.items)
        setTotal(res.total)
        setError(null)
      } catch (err) {
        if (cancelled) return
        // Previously only console.error'd, so a failed load was indistinguishable from "no roles
        // exist" — an operator would conclude the roles had been deleted.
        setError(err instanceof ApiError ? err.message : 'Could not load roles.')
        setRoles([])
        setTotal(0)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [hasAccessToken, debouncedSearch, page, dataRevision])

  // A new search term invalidates the current page number.
  useEffect(() => {
    setPage(1)
  }, [debouncedSearch])

  /** Role names from the page already fetched for this query — a recommendation costs no request. */
  const roleSuggestions: SearchFieldSuggestion[] = useMemo(
    () => roles.slice(0, 8).map((r) => ({ id: r.name, label: r.name })),
    [roles],
  )

  async function confirmDelete() {
    if (!pendingDelete || !accessToken) return
    const roleName = pendingDelete.name
    setDeleting(true)
    try {
      const result = await rolesApi.remove(accessToken, pendingDelete.id)
      setPendingDelete(null)
      if (isApprovalPending(result)) {
        toast.success(result.message)
        return
      }
      toast.success(`Role '${roleName}' deleted successfully.`)
      // If the last row on the final page just went, step back rather than showing an empty page.
      if (roles.length === 1 && page > 1) setPage((p) => p - 1)
      else invalidate(TOPICS.roles, TOPICS.approvals, TOPICS.kpis)
    } catch (err) {
      setPendingDelete(null)
      const conflict = asPendingApprovalConflict(err)
      if (conflict) {
        setApprovalConflict(conflict)
        return
      }
      setError(err instanceof ApiError ? err.message : 'Could not delete this role.')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <div className={styles.container}>
      <div className={styles.header}>
        <div>
          <h3 className={styles.title}>Roles</h3>
          <p className={styles.subtitle}>Define roles and configure granular permissions.</p>
        </div>
        {canCreate && (
          <button
            type="button"
            className={styles.createButton}
            onClick={() => pushLayer({ type: 'role-form' })}
          >
            <Icon.Plus width={16} height={16} />
            <span>Add Role</span>
          </button>
        )}
      </div>

      {/* Shared SearchField rather than a local input, so this box recommends as you type like
          every other search on the platform. Candidates come from the roles already fetched for
          this same query — no extra request, and never a role this list could not show. */}
      <SearchField
        placeholder="Search roles..."
        value={search}
        onValueChange={setSearch}
        suggestions={roleSuggestions}
        onSelectSuggestion={(s) => setSearch(s.id)}
        emptyHint="No matching role."
      />

      {error && (
        <div className={styles.errorBanner} role="alert">
          {error}
        </div>
      )}

      <div className={styles.rolesList}>
        {loading ? (
          Array.from({ length: 4 }).map((_, i) => (
            <SkeletonRoleCard key={i} />
          ))
        ) : roles.length > 0 ? (
          roles.map((role) => (
            <div key={role.id} className={styles.roleCard}>
              <div className={styles.roleIconWrap}>
                <Icon.ShieldCheck width={20} height={20} />
              </div>

              <div className={styles.roleInfo}>
                <div className={styles.roleNameRow}>
                  <span className={styles.roleName}>{role.name}</span>
                  {role.isAdministrator && <span className={styles.adminBadge}>Administrator</span>}
                  {role.isSystemRole && <span className={styles.systemBadge}>System</span>}
                </div>
                <span className={styles.roleDesc}>
                  {role.description ||
                    (role.isAdministrator ? 'Full platform administrator access' : 'Custom defined role')}
                </span>
              </div>

              {/*
                Two guards beyond the plain capability check, both mirroring server-side rules so the
                operator never reaches a button that can only fail:

                - An administrator role may only be touched by an administrator. It confers
                  unrestricted access, so editing or deleting one from a lesser account is a
                  privilege-escalation surface (RoleAppService refuses it outright).
                - Your own role can't be deleted — that would strip your access mid-session.

                `isSystemRole` continues to hide Delete on the built-in roles as before.
              */}
              <div className={styles.roleActions}>
                {canEdit && (!role.isAdministrator || isAdministrator) && (
                  <button
                    type="button"
                    className={styles.editBtn}
                    onClick={() => pushLayer({ type: 'role-form', roleId: role.id })}
                    title="Edit Role & Permissions"
                  >
                    <Icon.Edit width={16} height={16} />
                  </button>
                )}
                {canDelete
                  && !role.isSystemRole
                  && role.id !== currentUserRoleId
                  && (!role.isAdministrator || isAdministrator) && (
                  <button
                    type="button"
                    className={styles.deleteBtn}
                    onClick={() => setPendingDelete(role)}
                    title="Delete Role"
                  >
                    <Icon.Trash width={16} height={16} />
                  </button>
                )}
              </div>
            </div>
          ))
        ) : (
          <EmptyState
            compact
            title={search ? 'No roles match this search.' : 'No roles found.'}
          />
        )}
      </div>

      {/*
        Real pagination. The footer previously rendered a permanently disabled prev/next either side
        of a literal "1", so with more roles than one page the remainder was simply unreachable —
        the server defaults to 25 per page and there was no way to ask for page 2.
      */}
      {total > 0 && (
        <Pagination page={page} pageSize={PAGE_SIZE} total={total} onPageChange={setPage} itemLabel="role" />
      )}

      {/* window.confirm replaced: it can't be styled, isn't keyboard-trapped with the drawer, and in
          some browsers is suppressed entirely, which would have made deletion silently do nothing. */}
      <Modal
        open={Boolean(pendingDelete)}
        title={`Delete ${pendingDelete?.name}?`}
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
        Any user currently holding this role loses the permissions it grants. This cannot be undone.
      </Modal>

      <PendingApprovalDialog conflict={approvalConflict} onClose={() => setApprovalConflict(null)} />
    </div>
  )
}
