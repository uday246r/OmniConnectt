import { useEffect, useMemo, useState } from 'react'
import { Button, PageHeader } from '@omniconnect/ui'
import { useAuthStore, isSuperAdminOrAdmin } from '../../auth/store/authStore'
import { passwordPolicyApi, type PasswordPolicyCatalogDto } from '../api/passwordPolicyApi'
import { GlobalPolicyCard } from '../components/GlobalPolicyCard'
import { RoleExpiryTable } from '../components/RoleExpiryTable'
import { buildPolicy, isDirty, toDraft, type DraftErrors, type PolicyDraft } from '../utils/policyDraft'
import { Icon } from '../../../shared/components/Icon/Icon'
import { SkeletonBlock } from '../../../shared/components/Skeleton'
import { ApiError } from '../../../shared/api/httpClient'
import { toast } from '../../../shared/stores/toastStore'
import styles from './ManagePasswordPolicyPage.module.css'

type TabKey = 'global' | 'roles'

const NO_ERRORS: DraftErrors = { roles: {} }

/**
 * Settings > Manage Password Policy — its own page, deliberately not a tab inside Manage Fields. How long
 * a credential lives is a security control, gated by its own permission (`host.settings.password-policy`),
 * and the person who shapes the user form is not necessarily the person who should set it.
 *
 * Deliberately small: one lifetime, per-role lifetimes, what a new password must contain, and when people
 * are warned. Same flow as the other admin catalogs — edit a local draft, one Save, one PUT carrying the
 * version this page loaded so a concurrent edit is refused rather than overwritten.
 */
export function ManagePasswordPolicyPage() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const hasAccessToken = Boolean(accessToken)
  const isAdministrator = useAuthStore((s) => isSuperAdminOrAdmin(s.user))
  const hasCapability = useAuthStore((s) => s.hasCapability)
  const canEdit = isAdministrator || hasCapability('host.settings.password-policy', 'Edit')

  const [activeTab, setActiveTab] = useState<TabKey>('global')
  const [catalog, setCatalog] = useState<PasswordPolicyCatalogDto | null>(null)
  const [draft, setDraft] = useState<PolicyDraft | null>(null)
  const [errors, setErrors] = useState<DraftErrors>(NO_ERRORS)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)

  async function load() {
    if (!accessToken) return
    setLoading(true)
    try {
      const res = await passwordPolicyApi.get(accessToken)
      setCatalog(res)
      setDraft(toDraft(res.policy))
      setErrors(NO_ERRORS)
      setError(null)
      setConflict(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the password policy.')
    } finally {
      setLoading(false)
    }
  }

  // hasAccessToken, not accessToken: a silent token refresh every few minutes must not reload the page
  // and throw away what the admin is in the middle of typing.
  useEffect(() => { void load() }, [hasAccessToken])

  const dirty = useMemo(() => (catalog && draft ? isDirty(draft, catalog.policy) : false), [catalog, draft])
  const roles = catalog?.roles ?? []

  function patch(change: Partial<PolicyDraft>) {
    setDraft((prev) => (prev ? { ...prev, ...change } : prev))
    // A stale message about a field the admin is now editing would just be noise; a fresh validation
    // pass on Save re-derives whatever still applies.
    setErrors(NO_ERRORS)
  }

  function setRoleDays(roleId: string, value: string) {
    setDraft((prev) => (prev ? { ...prev, roleDays: { ...prev.roleDays, [roleId]: value } } : prev))
    setErrors((prev) => ({ ...prev, roles: { ...prev.roles, [roleId]: '' } }))
  }

  function handleDiscard() {
    if (!catalog) return
    setDraft(toDraft(catalog.policy))
    setErrors(NO_ERRORS)
    toast.info('Discarded unsaved policy changes.')
  }

  async function handleSave() {
    if (!accessToken || !catalog || !draft) return

    const { policy, errors: found } = buildPolicy(draft, roles.map((r) => r.id))
    if (!policy) {
      setErrors(found)
      // Take the admin to the tab that holds the first problem instead of leaving them to hunt for it.
      if (Object.keys(found.roles).length > 0 && !found.expiryDays && !found.minimumLength && !found.maximumLength && !found.leadDays) {
        setActiveTab('roles')
      } else {
        setActiveTab('global')
      }
      return
    }

    setSaving(true)
    try {
      const res = await passwordPolicyApi.update(accessToken, { policy, expectedVersion: catalog.version })
      setCatalog(res)
      setDraft(toDraft(res.policy))
      setErrors(NO_ERRORS)
      setConflict(false)
      setError(null)
      toast.success('Password policy updated. It applies from the next sign-in.')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflict(true)
        setError(err.message)
      } else {
        toast.error(err instanceof ApiError ? err.message : 'Could not save the password policy.')
      }
    } finally {
      setSaving(false)
    }
  }

  const saved = catalog?.policy
  const savedExpiry = saved ? (saved.expiryDays === 0 ? 'Never' : `${saved.expiryDays} days`) : '—'
  const remindersOn = Boolean(saved && saved.expiryDays > 0 && saved.notifications.leadDays.length > 0 && (saved.notifications.email || saved.notifications.inApp))
  const channels = saved ? [saved.notifications.email && 'Email', saved.notifications.inApp && 'In-app'].filter(Boolean).join(' + ') : ''

  return (
    <div className={styles.page}>
      <PageHeader
        icon={<Icon.Lock width={22} height={22} />}
        title="Manage Password Policy"
        subtitle="Set how long passwords last, what a new password must contain, and when people are warned before theirs expires."
      />

      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconBlue}`}><Icon.Clock width={20} height={20} /></div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Password lifetime</span>
            <span className={styles.summaryValue}>{loading ? '—' : savedExpiry}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconPurple}`}><Icon.Users width={20} height={20} /></div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Roles with their own lifetime</span>
            <span className={styles.summaryValue}>{loading || !saved ? '—' : `${saved.roleExpiries.length} of ${roles.length}`}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconGreen}`}><Icon.Bell width={20} height={20} /></div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Reminders</span>
            <span className={styles.summaryValue}>{loading || !saved ? '—' : remindersOn ? channels : 'Off'}</span>
            {remindersOn && saved && <span className={styles.summarySub}>{saved.notifications.leadDays.join(' / ')} days before</span>}
          </div>
        </div>
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          <span className={styles.errorBannerText}>
            <Icon.AlertCircle width={16} height={16} />
            {error}
          </span>
          {(conflict || !catalog) && (
            <Button variant="secondary" size="sm" onClick={() => void load()}>Reload</Button>
          )}
        </div>
      )}

      {loading ? (
        <div className={styles.card}>
          <div className={styles.skeletons}>
            {Array.from({ length: 3 }).map((_, i) => (
              <SkeletonBlock key={i} width="100%" height={56} radius="10px" />
            ))}
          </div>
        </div>
      ) : catalog && draft ? (
        <>
          <div className={styles.tabList} role="tablist" aria-label="Password policy sections">
            <button
              type="button"
              role="tab"
              id="pp-tab-global"
              aria-selected={activeTab === 'global'}
              aria-controls="pp-panel-global"
              className={`${styles.tabBtn} ${activeTab === 'global' ? styles.tabBtnActive : ''}`}
              onClick={() => setActiveTab('global')}
            >
              <Icon.ShieldCheck width={15} height={15} />
              <span>Global Policy</span>
            </button>
            <button
              type="button"
              role="tab"
              id="pp-tab-roles"
              aria-selected={activeTab === 'roles'}
              aria-controls="pp-panel-roles"
              className={`${styles.tabBtn} ${activeTab === 'roles' ? styles.tabBtnActive : ''}`}
              onClick={() => setActiveTab('roles')}
            >
              <Icon.Users width={15} height={15} />
              <span>Role Policies</span>
              {saved && saved.roleExpiries.length > 0 && <span className={styles.tabBadge}>{saved.roleExpiries.length}</span>}
            </button>
          </div>

          {activeTab === 'global' && (
            <div id="pp-panel-global" role="tabpanel" aria-labelledby="pp-tab-global">
              <GlobalPolicyCard draft={draft} errors={errors} canEdit={canEdit} onChange={patch} />
            </div>
          )}

          {activeTab === 'roles' && (
            <div id="pp-panel-roles" role="tabpanel" aria-labelledby="pp-tab-roles" className={styles.card}>
              <div className={styles.cardHead}>
                <span className={`${styles.headIcon} ${styles.iconPurple}`}><Icon.Users width={17} height={17} /></span>
                <div>
                  <h3 className={styles.headTitle}>Password lifetime by role</h3>
                  <p className={styles.headDesc}>
                    Give a role its own lifetime — shorter or longer than the global one. Leave it blank to inherit.
                  </p>
                </div>
              </div>
              <RoleExpiryTable
                roles={roles}
                roleDays={draft.roleDays}
                globalDays={draft.expiryDays}
                errors={errors}
                canEdit={canEdit}
                onChange={setRoleDays}
              />
            </div>
          )}
        </>
      ) : null}

      {canEdit && dirty && (
        <div className={styles.saveBar} role="region" aria-label="Unsaved password policy changes">
          <div className={styles.saveBarInfo}>
            <Icon.AlertCircle width={18} height={18} />
            <span>You have unsaved changes to the password policy.</span>
          </div>
          <div className={styles.saveBarActions}>
            <Button variant="secondary" size="sm" onClick={handleDiscard}>Discard</Button>
            <Button variant="primary" size="sm" loading={saving} onClick={() => void handleSave()}>Save Changes</Button>
          </div>
        </div>
      )}
    </div>
  )
}
