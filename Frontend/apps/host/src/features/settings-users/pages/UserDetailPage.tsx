import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useAuthStore } from '../../auth/store/authStore'
import { useRemoteHealthStore } from '../../../shared/stores/remoteHealthStore'
import { useSettingsDrawerStore } from '../../../shared/stores/settingsDrawerStore'
import { TOPICS, invalidate, useDataRevision } from '../../../shared/stores/invalidationStore'
import { ApiError } from '../../../shared/api/httpClient'
import { Icon } from '../../../shared/components/Icon/Icon'
import { toast } from '../../../shared/stores/toastStore'
import { usersApi, type UserDetailDto } from '../api/usersApi'
import { userSchemaApi } from '../../settings-user-fields/api/userSchemaApi'
import type { FieldDefinition } from '@omniconnect/ui/validation'
import { rolesApi, type RoleDetailDto } from '../../settings-roles/api/rolesApi'
import { isApprovalPending } from '../../approvals/api/approvalsApi'
import { asPendingApprovalConflict, type PendingApprovalConflict } from '../../approvals/pendingConflict'
import { PendingApprovalDialog } from '../../approvals/components/PendingApprovalDialog'
import { usePermissionCatalog } from '../hooks/usePermissionCatalog'
import { computeEffectivePermissions } from '../utils/effectivePermissions'
import { PermissionMatrixTable } from '../components/PermissionMatrixTable/PermissionMatrixTable'
import { UserActivityTab } from '../components/UserActivityTab/UserActivityTab'
import {
  Badge,
  Button,
  DetailField,
  DetailGrid,
  DetailSection,
  DetailSections,
  EMPTY_VALUE,
  EmptyState,
  Modal,
  PageHeader,
  Tabs,
  TabPanel,
  formatDateTime,
} from '@omniconnect/ui'
import styles from './UserDetailPage.module.css'

type DetailTab = 'profile' | 'permissions' | 'activity'

export function UserDetailPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.accessToken)
  // A token refresh must not re-run a load (and reset what the user is editing) — only its first arrival.
  const hasAccessToken = Boolean(accessToken)
  const isAdministrator = Boolean(useAuthStore((s) => s.user)?.isAdministrator)
  const hasCapability = useAuthStore((s) => s.hasCapability)
  const currentUserId = useAuthStore((s) => s.user?.id)
  const registryApps = useRemoteHealthStore((s) => s.entries)
  const pushLayer = useSettingsDrawerStore((s) => s.pushLayer)
  const dataRevision = useDataRevision(TOPICS.users)
  const { catalog } = usePermissionCatalog()

  const canEdit = isAdministrator || hasCapability('host.settings.users', 'Edit')
  const canDelete = isAdministrator || hasCapability('host.settings.users', 'Delete')
  const canDisable = isAdministrator || hasCapability('host.settings.users', 'Disable')

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
  }, [hasAccessToken, id, dataRevision])

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
  }, [hasAccessToken])


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
        {tab === 'activity' && <UserActivityTab userId={detail.id} userName={detail.name || detail.email} />}
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
    </div>
  )
}
