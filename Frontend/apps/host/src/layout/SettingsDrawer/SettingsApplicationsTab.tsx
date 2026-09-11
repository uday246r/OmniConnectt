import { useEffect, useMemo, useState } from 'react'
import { useAuthStore } from '../../features/auth/store/authStore'
import { remoteAppsApi, type RemoteAppDto, type RemoteAppStatus } from '../../features/settings-applications/api/remoteAppsApi'
import { isApprovalPending } from '../../features/approvals/api/approvalsApi'
import { useSettingsDrawerStore } from '../../shared/stores/settingsDrawerStore'
import { useDebouncedValue } from '../../shared/hooks/useDebouncedValue'
import { useNavigationStore } from '../../shared/stores/navigationStore'
import { useRemoteHealthStore } from '../../shared/stores/remoteHealthStore'
import { Icon } from '../../shared/components/Icon/Icon'
import { SkeletonAppCard } from '../../shared/components/Skeleton'
import { ApiError } from '../../shared/api/httpClient'
import { toast } from '../../shared/stores/toastStore'
import styles from './SettingsApplicationsTab.module.css'
import { TOPICS, invalidate, useDataRevision } from '../../shared/stores/invalidationStore'
import { Button, EmptyState, Modal, Pagination, SearchField, type SearchFieldSuggestion } from '@omniremit/ui'

const PAGE_SIZE = 10

export function SettingsApplicationsTab() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const isAdministrator = Boolean(useAuthStore((s) => s.user)?.isAdministrator)
  const hasCapability = useAuthStore((s) => s.hasCapability)
  const pushLayer = useSettingsDrawerStore((s) => s.pushLayer)
  const dataRevision = useDataRevision(TOPICS.applications)

  const canRegister = isAdministrator || hasCapability('host.settings.applications', 'Register') || hasCapability('host.settings.applications', 'Create')
  const canEdit = isAdministrator || hasCapability('host.settings.applications', 'Edit')
  const canDelete = isAdministrator || hasCapability('host.settings.applications', 'Delete') || hasCapability('host.settings.applications', 'Remove')
  const canResync = isAdministrator || hasCapability('host.settings.applications', 'Edit') || hasCapability('host.settings.applications', 'Resync')

  const [apps, setApps] = useState<RemoteAppDto[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [pendingDelete, setPendingDelete] = useState<RemoteAppDto | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [resyncing, setResyncing] = useState(false)
  const [resyncResult, setResyncResult] = useState<string | null>(null)

  const debouncedSearch = useDebouncedValue(search, 300)
  const [activeMenuId, setActiveMenuId] = useState<string | null>(null)

  // Status Change Modal State
  const [statusTargetApp, setStatusTargetApp] = useState<RemoteAppDto | null>(null)
  const [newStatus, setNewStatus] = useState<RemoteAppStatus>('Active')
  const [maintenanceMessage, setMaintenanceMessage] = useState('')
  const [updatingStatus, setUpdatingStatus] = useState(false)

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const res = await remoteAppsApi.list(accessToken!, {
          page,
          pageSize: PAGE_SIZE,
          search: debouncedSearch || undefined,
        })
        if (cancelled) return
        setApps(res.items)
        setTotal(res.total)
        setError(null)
      } catch (err) {
        if (cancelled) return
        // Was console-only, so a failed load looked identical to "no applications registered" —
        // alarming and misleading when the registry is simply unreachable.
        setError(err instanceof ApiError ? err.message : 'Could not load applications.')
        setApps([])
        setTotal(0)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [accessToken, debouncedSearch, page, dataRevision])

  useEffect(() => {
    setPage(1)
  }, [debouncedSearch])

  /** Names from the page already fetched for this query — a recommendation costs no request. */
  const appSuggestions: SearchFieldSuggestion[] = useMemo(
    () => apps.slice(0, 8).map((a) => ({ id: a.displayName, label: a.displayName })),
    [apps],
  )

  async function confirmDelete() {
    if (!pendingDelete || !accessToken) return
    const deletedName = pendingDelete.displayName
    setDeleting(true)
    try {
      const result = await remoteAppsApi.remove(accessToken, pendingDelete.id)
      setPendingDelete(null)
      if (isApprovalPending(result)) {
        // Nothing was actually removed — no sidebar refresh needed, nothing changed yet.
        toast.success(result.message)
        return
      }
      toast.success(`Application '${deletedName}' removed successfully.`)
      // The sidebar is rendered from the navigation tree, so that is what has to be refreshed or the
      // removed app lingers there until the next full page load.
      void useNavigationStore.getState().fetch(accessToken)
      void useRemoteHealthStore.getState().fetch(accessToken)
      if (apps.length === 1 && page > 1) setPage((p) => p - 1)
      else invalidate(TOPICS.applications, TOPICS.approvals, TOPICS.kpis)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not remove this application.')
      setPendingDelete(null)
    } finally {
      setDeleting(false)
      setActiveMenuId(null)
    }
  }

  const handleResync = async () => {
    if (!accessToken) return
    setResyncing(true)
    setResyncResult(null)
    try {
      const res = await remoteAppsApi.resyncPermissions(accessToken)
      setResyncResult(`Resynced permissions for ${res.resyncedCount} application(s).`)
      toast.success(`Resynced permissions for ${res.resyncedCount} application(s).`)
      invalidate(TOPICS.applications, TOPICS.approvals, TOPICS.kpis)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not resync permissions.')
    } finally {
      setResyncing(false)
      setActiveMenuId(null)
    }
  }

  const openStatusModal = (app: RemoteAppDto) => {
    setStatusTargetApp(app)
    setNewStatus(app.status)
    setMaintenanceMessage(app.maintenanceMessage || '')
    setActiveMenuId(null)
  }

  const handleSaveStatus = async () => {
    if (!accessToken || !statusTargetApp) return
    const appName = statusTargetApp.displayName
    setUpdatingStatus(true)
    try {
      const result = await remoteAppsApi.updateStatus(
        accessToken,
        statusTargetApp.id,
        newStatus,
        newStatus === 'Maintenance' ? maintenanceMessage || 'Application is temporarily down for maintenance.' : null
      )
      setStatusTargetApp(null)
      if (isApprovalPending(result)) {
        // Nothing actually changed yet — no sidebar refresh needed.
        toast.success(result.message)
        return
      }
      toast.success(`Application '${appName}' status updated to ${newStatus}.`)
      // The sidebar has to be refreshed too: an app moved to Maintenance must stop being navigable
      // immediately, without waiting for a page reload.
      void useNavigationStore.getState().fetch(accessToken)
      void useRemoteHealthStore.getState().fetch(accessToken)
      invalidate(TOPICS.applications, TOPICS.approvals, TOPICS.kpis)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not update this application.')
    } finally {
      setUpdatingStatus(false)
    }
  }

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div>
          <h3 className={styles.title}>Applications</h3>
          <p className={styles.subtitle}>Register and manage federated micro-frontend modules.</p>
        </div>
        {canRegister && (
          <button
            type="button"
            className={styles.createButton}
            onClick={() => pushLayer({ type: 'app-form' })}
          >
            <Icon.Plus width={16} height={16} />
            <span>Add Application</span>
          </button>
        )}
      </div>

      {/* Shared SearchField rather than a local input, so this box recommends as you type like
          every other search on the platform, from the applications already fetched. */}
      <SearchField
        placeholder="Search applications..."
        value={search}
        onValueChange={setSearch}
        suggestions={appSuggestions}
        onSelectSuggestion={(s) => setSearch(s.id)}
        emptyHint="No matching application."
      />

      {error && (
        <div className={styles.errorBanner} role="alert">
          {error}
        </div>
      )}

      {resyncResult && (
        <div className={styles.successBanner} role="status">
          {resyncResult}
        </div>
      )}

      {/* Apps List */}
      <div className={styles.appList}>
        {loading ? (
          Array.from({ length: 3 }).map((_, i) => (
            <SkeletonAppCard key={i} />
          ))
        ) : apps.length > 0 ? (
          apps.map((app) => {
            const isMaintenance = app.status === 'Maintenance'
            const isDisabled = app.status === 'Disabled'

            return (
              <div key={app.id} className={styles.appCard}>
                {/* App Icon */}
                <div
                  className={`${styles.appIconWrap} ${
                    isMaintenance
                      ? styles.appIconWrapMaintenance
                      : isDisabled
                      ? styles.appIconWrapDisabled
                      : styles.appIconWrapActive
                  }`}
                >
                  <Icon.Users width={20} height={20} />
                </div>

                {/* Info */}
                <div className={styles.appInfo}>
                  <div className={styles.appNameRow}>
                    <span className={styles.appName}>{app.displayName}</span>
                    <span className={styles.appKey}>{app.key}</span>
                  </div>
                  <span className={styles.appDesc}>
                    {isMaintenance && app.maintenanceMessage ? `⚠️ ${app.maintenanceMessage}` : app.manifestUrl}
                  </span>
                </div>

                {/* Status & Quick Actions */}
                <div className={styles.appMeta}>
                  {/* Clickable Status Badge to quickly change status */}
                  <button
                    type="button"
                    className={
                      isMaintenance
                        ? styles.maintenanceBadge
                        : isDisabled
                        ? styles.disabledBadge
                        : styles.activeBadge
                    }
                    onClick={() => canEdit && openStatusModal(app)}
                    title={canEdit ? 'Click to change application status' : undefined}
                    disabled={!canEdit}
                  >
                    <span
                      className={
                        isMaintenance
                          ? styles.badgeDotAmber
                          : isDisabled
                          ? styles.badgeDotGray
                          : styles.badgeDotGreen
                      }
                    />
                    <span>{app.status}</span>
                  </button>

                  {/* Direct Edit Button along with the Status */}
                  {canEdit && (
                    <button
                      type="button"
                      className={styles.editBtn}
                      onClick={() => pushLayer({ type: 'app-form', appId: app.id })}
                      title="Edit Application"
                    >
                      <Icon.Edit width={16} height={16} />
                    </button>
                  )}

                  {/* Direct Delete Button */}
                  {canDelete && (
                    <button
                      type="button"
                      className={styles.deleteBtn}
                      onClick={() => setPendingDelete(app)}
                      title="Delete Application"
                    >
                      <Icon.Trash width={16} height={16} />
                    </button>
                  )}

                  {/* More Menu for additional actions */}
                  <div className={styles.menuContainer}>
                    <button
                      type="button"
                      className={styles.moreButton}
                      onClick={() => setActiveMenuId(activeMenuId === app.id ? null : app.id)}
                      aria-label="Actions"
                      title="More Options"
                    >
                      <Icon.MoreVertical width={16} height={16} />
                    </button>

                    {activeMenuId === app.id && (
                      <div className={styles.menuDropdown}>
                        {canEdit && (
                          <button
                            type="button"
                            className={styles.menuItem}
                            onClick={() => openStatusModal(app)}
                          >
                            <Icon.Activity width={14} height={14} />
                            <span>Change Status</span>
                          </button>
                        )}
                        {canResync && (
                          <button
                            type="button"
                            className={styles.menuItem}
                            onClick={() => void handleResync()}
                            disabled={resyncing}
                          >
                            <Icon.Activity width={14} height={14} />
                            {/* Resync fans out an HTTP call per registered app, so it can take a
                                few seconds. Without this the menu looked inert and invited a
                                second click, firing the whole sweep twice. */}
                            <span>{resyncing ? 'Resyncing…' : 'Resync Permissions'}</span>
                          </button>
                        )}
                        {canDelete && (
                          <button
                            type="button"
                            className={`${styles.menuItem} ${styles.menuItemDelete}`}
                            onClick={() => setPendingDelete(app)}
                          >
                            <Icon.Trash width={14} height={14} />
                            <span>Remove App</span>
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        ) : (
          <EmptyState compact title="No applications registered yet." />
        )}
      </div>

      {/*
        Real pagination, replacing a permanently disabled prev/next around a literal "1" — with more
        registered applications than one page, the rest could not be reached at all.
      */}
      {total > 0 && (
        <Pagination
          page={page}
          pageSize={PAGE_SIZE}
          total={total}
          onPageChange={setPage}
          itemLabel="application"
        />
      )}

      <Modal
        open={Boolean(pendingDelete)}
        title={`Remove ${pendingDelete?.displayName}?`}
        onClose={() => setPendingDelete(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button variant="danger" loading={deleting} onClick={confirmDelete}>
              Remove
            </Button>
          </>
        }
      >
        This unregisters the application and removes it from the sidebar. Every permission granted
        against it stops taking effect. The application&rsquo;s own data is untouched.
      </Modal>

      {/* Status Change Modal Dialog */}
      {statusTargetApp && (
        <div className={styles.statusModalOverlay}>
          <div className={styles.statusModalContent}>
            <div className={styles.statusModalHeader}>
              <div>
                <h4 className={styles.statusModalTitle}>Update Application Status</h4>
                <p className={styles.statusModalSubtitle}>
                  Set runtime accessibility for <strong>{statusTargetApp.displayName}</strong>
                </p>
              </div>
              <button
                type="button"
                className={styles.modalCloseBtn}
                onClick={() => setStatusTargetApp(null)}
              >
                <Icon.X width={18} height={18} />
              </button>
            </div>

            <div className={styles.statusOptionsList}>
              <label
                className={`${styles.statusOptionCard} ${newStatus === 'Active' ? styles.optionActive : ''}`}
                onClick={() => setNewStatus('Active')}
              >
                <input
                  type="radio"
                  name="appStatus"
                  checked={newStatus === 'Active'}
                  onChange={() => setNewStatus('Active')}
                />
                <div className={styles.optionTextWrap}>
                  <div className={styles.optionTitleRow}>
                    <span className={styles.badgeDotGreen} />
                    <span className={styles.optionTitle}>Active</span>
                  </div>
                  <span className={styles.optionDesc}>
                    Application is live and accessible to all authorized users.
                  </span>
                </div>
              </label>

              <label
                className={`${styles.statusOptionCard} ${newStatus === 'Maintenance' ? styles.optionActive : ''}`}
                onClick={() => setNewStatus('Maintenance')}
              >
                <input
                  type="radio"
                  name="appStatus"
                  checked={newStatus === 'Maintenance'}
                  onChange={() => setNewStatus('Maintenance')}
                />
                <div className={styles.optionTextWrap}>
                  <div className={styles.optionTitleRow}>
                    <span className={styles.badgeDotAmber} />
                    <span className={styles.optionTitle}>Maintenance Mode</span>
                  </div>
                  <span className={styles.optionDesc}>
                    Shows a friendly maintenance notice to users while you perform updates.
                  </span>
                </div>
              </label>

              <label
                className={`${styles.statusOptionCard} ${newStatus === 'Disabled' ? styles.optionActive : ''}`}
                onClick={() => setNewStatus('Disabled')}
              >
                <input
                  type="radio"
                  name="appStatus"
                  checked={newStatus === 'Disabled'}
                  onChange={() => setNewStatus('Disabled')}
                />
                <div className={styles.optionTextWrap}>
                  <div className={styles.optionTitleRow}>
                    <span className={styles.badgeDotGray} />
                    <span className={styles.optionTitle}>Disabled</span>
                  </div>
                  <span className={styles.optionDesc}>
                    Hides the application entirely from users and navigation menus.
                  </span>
                </div>
              </label>
            </div>

            {newStatus === 'Maintenance' && (
              <div className={styles.messageGroup}>
                <label className={styles.messageLabel}>Maintenance Notice to Users</label>
                <input
                  type="text"
                  className={styles.messageInput}
                  placeholder="e.g. Upgrading server infrastructure. Expected back in 30 mins."
                  value={maintenanceMessage}
                  onChange={(e) => setMaintenanceMessage(e.target.value)}
                />
              </div>
            )}

            <div className={styles.statusModalActions}>
              <button
                type="button"
                className={styles.cancelModalBtn}
                onClick={() => setStatusTargetApp(null)}
              >
                Cancel
              </button>
              <button
                type="button"
                className={styles.saveModalBtn}
                onClick={() => void handleSaveStatus()}
                disabled={updatingStatus}
              >
                {updatingStatus ? 'Updating...' : 'Apply Status'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
