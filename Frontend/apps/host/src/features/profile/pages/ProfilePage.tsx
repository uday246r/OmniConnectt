import { useEffect, useState, useMemo, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../auth/store/authStore'
import { useModuleRegistryStore } from '../../../shared/stores/moduleRegistryStore'
import { usersApi } from '../../settings-users/api/usersApi'
import { salutationsApi } from '../../settings-user-fields/api/salutationsApi'
import { usePermissionCatalog } from '../../settings-users/hooks/usePermissionCatalog'
import { PermissionMatrixTable } from '../../settings-users/components/PermissionMatrixTable/PermissionMatrixTable'
import { isApprovalPending } from '../../approvals/api/approvalsApi'
import { ChangePasswordForm } from '../components/ChangePasswordForm'
import { Icon } from '../../../shared/components/Icon/Icon'
import { required, email as emailRule, firstError } from '../../../shared/validation/rules'
import { validateFullPhone } from '@omniremit/ui/validation'
import styles from './ProfilePage.module.css'
import { Button, Input } from '@omniremit/ui'

function formatDateTime(iso: string | null) {
  if (!iso) return 'Never'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return date.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function getUserInitials(name?: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/)
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }
  return name.slice(0, 2).toUpperCase()
}

type DrawerTab = 'profile' | 'password'

export function ProfilePage() {
  const navigate = useNavigate()
  const user = useAuthStore((s) => s.user)
  const accessToken = useAuthStore((s) => s.accessToken)
  const fineCapabilities = useAuthStore((s) => s.fineCapabilities)
  const refreshSession = useAuthStore((s) => s.refreshSession)
  const registryApps = useModuleRegistryStore((s) => s.apps)

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<DrawerTab>('profile')

  // Profile Form state
  const [salutation, setSalutation] = useState(user?.salutation || '')
  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [phoneNumber, setPhoneNumber] = useState(user?.phoneNumber || '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)
  const [salutationOptions, setSalutationOptions] = useState<string[]>([])

  // Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  const { catalog } = usePermissionCatalog()

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false
    salutationsApi
      .get(accessToken)
      .then((res) => {
        if (!cancelled) setSalutationOptions(res.salutations)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [accessToken])

  if (!user) return null

  const isGoogle = user.authProvider === 'Google'
  const isSuperAdmin = user.isAdministrator
  const initials = getUserInitials(user.name)

  function openDrawer(tab: DrawerTab = 'profile') {
    setSalutation(user?.salutation || '')
    setName(user?.name || '')
    setEmail(user?.email || '')
    setPhoneNumber(user?.phoneNumber || '')
    setProfileError(null)
    setActiveTab(tab)
    setDrawerOpen(true)
  }

  function closeDrawer() {
    if (savingProfile) return
    setDrawerOpen(false)
  }

  function triggerToast(msg: string) {
    setToastMessage(msg)
    setTimeout(() => setToastMessage(null), 3500)
  }

  async function handleSaveProfile(e: FormEvent) {
    e.preventDefault()

    const problem = firstError(
      required(name, 'Full name'),
      isSuperAdmin ? emailRule(email) : undefined,
      phoneNumber.trim() ? validateFullPhone(phoneNumber) : undefined,
    )
    if (problem) {
      setProfileError(problem)
      return
    }

    if (!accessToken || !user) return

    setSavingProfile(true)
    setProfileError(null)

    try {
      const result = await usersApi.update(accessToken, user.id, {
        name: name.trim(),
        email: isSuperAdmin ? email.trim() : user.email,
        phoneNumber: phoneNumber.trim() || null,
        roleId: user.roleId,
        isActive: user.isActive,
        salutation: salutation || null,
      })

      if (isApprovalPending(result)) {
        setDrawerOpen(false)
        triggerToast(result.message)
        return
      }

      await refreshSession()
      setDrawerOpen(false)
      triggerToast('Profile information updated successfully.')
    } catch (err: unknown) {
      setProfileError(err instanceof Error ? err.message : 'Failed to update profile.')
    } finally {
      setSavingProfile(false)
    }
  }

  // Combine user.permissions and fineCapabilities
  const allEffectivePermissions = useMemo(() => {
    const set = new Set<string>(user?.permissions || [])
    for (const cap of fineCapabilities || []) {
      set.add(cap)
    }
    return Array.from(set)
  }, [user?.permissions, fineCapabilities])

  return (
    <div className={styles.page}>
      {/* Toast Notification */}
      {toastMessage && (
        <div className={styles.toastSuccess} role="alert">
          <Icon.CheckCircle width={18} height={18} />
          <span>{toastMessage}</span>
        </div>
      )}

      {/* Page Header — gradient */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.pageTitle}>User Profile</h1>
          <p className={styles.pageSubtitle}>
            Identity credentials, security authentication, and assigned RBAC role permissions.
          </p>
        </div>
        <div className={styles.headerActions}>
          <Button
            variant="secondary"
            onClick={() => navigate('/')}
            leadingIcon={<Icon.ChevronLeft width={14} height={14} />}
          >
            Back to Dashboard
          </Button>
          {!isGoogle && (
            <Button
              variant="secondary"
              onClick={() => openDrawer('password')}
              leadingIcon={<Icon.Lock width={14} height={14} />}
            >
              Change Password
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => openDrawer('profile')}
            leadingIcon={<Icon.Edit width={14} height={14} />}
          >
            Edit Profile
          </Button>
        </div>
      </div>

      {/* Main Identity Banner Card (Full Width) */}
      <div className={styles.identityCard}>
        <div className={styles.identityLeft}>
          <div className={styles.avatarWrap}>
            <div className={styles.avatar}>{initials}</div>
            <span className={styles.statusDot} title="Account Active" />
          </div>

          <div className={styles.identityInfo}>
            <div className={styles.nameRow}>
              <h2 className={styles.name}>{[user.salutation, user.name].filter(Boolean).join(' ')}</h2>
              {user.isAdministrator ? (
                <span className={styles.superAdminChip}>
                  <Icon.Crown width={13} height={13} />
                  Super Administrator
                </span>
              ) : (
                <span className={styles.roleChip}>
                  <Icon.ShieldCheck width={14} height={14} />
                  <span>{user.roleName || 'Standard User'}</span>
                </span>
              )}
            </div>
            <p className={styles.email}>{user.email}</p>
          </div>
        </div>

        <div className={styles.identityRight}>
          <span className={user.isActive ? styles.activeBadge : styles.inactiveBadge}>
            <span className={styles.livePulse} />
            {user.isActive ? 'Active Account' : 'Inactive'}
          </span>
        </div>
      </div>

      {/* Information Cards 2-Column Grid */}
      <div className={styles.grid}>
        {/* Card 1: Account Information */}
        <div className={styles.sectionCard}>
          <div className={styles.cardHeader}>
            <div className={styles.cardHeaderIcon}>
              <Icon.Users width={20} height={20} />
            </div>
            <div>
              <h3 className={styles.cardTitle}>Identity &amp; Profile</h3>
              <p className={styles.cardSubtitle}>Primary account contact details and identifiers</p>
            </div>
          </div>

          <div className={styles.detailsList}>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Salutation</span>
              <span className={styles.detailValue}>{user.salutation || 'Not set'}</span>
            </div>

            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Full Name</span>
              <span className={styles.detailValue}>{user.name}</span>
            </div>

            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Email Address</span>
              <span className={styles.detailValue}>{user.email}</span>
            </div>

            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Phone Number</span>
              <span className={styles.detailValue}>{user.phoneNumber || 'Not configured'}</span>
            </div>

            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Account Type</span>
              <span className={styles.detailValue}>
                {user.isAdministrator ? 'Super Administrator' : 'Standard Member'}
              </span>
            </div>

            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Account Status</span>
              <span className={styles.detailValueSuccess}>Active &amp; Verified</span>
            </div>
          </div>
        </div>

        {/* Card 2: Security & Authentication */}
        <div className={styles.sectionCard}>
          <div className={styles.cardHeader}>
            <div className={styles.cardHeaderIcon}>
              <Icon.Lock width={20} height={20} />
            </div>
            <div>
              <h3 className={styles.cardTitle}>Security &amp; Access</h3>
              <p className={styles.cardSubtitle}>Authentication method and session state</p>
            </div>
          </div>

          <div className={styles.detailsList}>
            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Assigned Role</span>
              <span className={styles.roleValuePill}>
                {user.isAdministrator ? 'Platform Administrator' : user.roleName || 'Normal User'}
              </span>
            </div>

            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Auth Provider</span>
              <span className={styles.detailValue}>
                {isGoogle ? 'Google Workspace SSO' : 'Local Platform Credentials'}
              </span>
            </div>

            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Password Protection</span>
              <span className={styles.detailValue}>
                {isGoogle ? 'Managed by Google' : 'Local Encrypted Password'}
              </span>
            </div>

            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Last Sign-in</span>
              <span className={styles.detailValue}>{formatDateTime(user.lastLoginAt)}</span>
            </div>

            <div className={styles.detailRow}>
              <span className={styles.detailLabel}>Session Security</span>
              <span className={styles.detailValue}>Encrypted JWT Session</span>
            </div>
          </div>

          {isGoogle && (
            <div className={styles.ssoNotice}>
              <Icon.CheckCircle width={15} height={15} />
              <span>Password and MFA security are federated via Google Workspace.</span>
            </div>
          )}
        </div>
      </div>

      {/* ── System Capabilities & Permissions ── */}
      <div className={styles.sectionCard}>
        <div className={styles.cardHeader}>
          <div className={`${styles.cardHeaderIcon} ${styles.iconGreen}`}>
            <Icon.ShieldCheck width={20} height={20} />
          </div>
          <div>
            <h3 className={styles.cardTitle}>System Capabilities &amp; Permissions</h3>
            <p className={styles.cardSubtitle}>
              {user.isAdministrator
                ? 'Super Administrators have complete, unrestricted access across all platform services and remote applications.'
                : 'Granted capabilities based on your assigned role and administrative overrides.'}
            </p>
          </div>
        </div>

        <PermissionMatrixTable
          permissions={allEffectivePermissions}
          catalog={catalog}
          registryApps={registryApps}
          isAdministrator={user.isAdministrator}
          roleName={user.roleName}
        />
      </div>

      {drawerOpen && (
        <div className={styles.drawerBackdrop} onClick={closeDrawer}>
          <div
            className={styles.drawerPanel}
            onClick={(e) => e.stopPropagation()}
            role="dialog"
            aria-modal="true"
          >
            {/* Drawer Header */}
            <div className={styles.drawerHeader}>
              <div className={styles.drawerHeaderTitleWrap}>
                <h2 className={styles.drawerTitle}>
                  {activeTab === 'profile' ? 'Edit Profile Information' : 'Update Account Password'}
                </h2>
                <p className={styles.drawerSubtitle}>
                  {activeTab === 'profile'
                    ? 'Update identity details and contact preferences'
                    : 'Manage local sign-in credentials and security'}
                </p>
              </div>
              <button
                type="button"
                className={styles.drawerCloseBtn}
                onClick={closeDrawer}
                aria-label="Close drawer"
              >
                ✕
              </button>
            </div>

            {/* Tab Navigation */}
            <div className={styles.drawerTabs}>
              <button
                type="button"
                className={`${styles.drawerTab} ${activeTab === 'profile' ? styles.drawerTabActive : ''}`}
                onClick={() => setActiveTab('profile')}
              >
                <Icon.Users width={15} height={15} />
                <span>Profile Details</span>
              </button>
              {!isGoogle && (
                <button
                  type="button"
                  className={`${styles.drawerTab} ${activeTab === 'password' ? styles.drawerTabActive : ''}`}
                  onClick={() => setActiveTab('password')}
                >
                  <Icon.Lock width={15} height={15} />
                  <span>Password &amp; Security</span>
                </button>
              )}
            </div>

            {/* Drawer Content */}
            <div className={styles.drawerBody}>
              {activeTab === 'profile' ? (
                <form onSubmit={handleSaveProfile} className={styles.formStack}>
                  {profileError && (
                    <div className={styles.formError} role="alert">
                      <Icon.AlertCircle width={16} height={16} />
                      <span>{profileError}</span>
                    </div>
                  )}

                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>Salutation</label>
                    <select
                      className={styles.selectInput}
                      value={salutation}
                      onChange={(e) => setSalutation(e.target.value)}
                      disabled={savingProfile}
                    >
                      <option value="">-- None --</option>
                      {salutationOptions.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>

                  <Input
                    label="Full Name"
                    placeholder="Your name"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    disabled={savingProfile}
                    leading={<Icon.Users width={16} height={16} />}
                  />

                  <Input
                    label="Email Address"
                    type="email"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                    disabled={!isSuperAdmin || isGoogle || savingProfile}
                    leading={<Icon.Mail width={16} height={16} />}
                    helperText={
                      !isSuperAdmin
                        ? '🔒 Email modification is restricted to Platform Administrators.'
                        : isGoogle
                        ? '🔒 Email is managed via Google Workspace SSO.'
                        : undefined
                    }
                  />

                  <Input
                    label="Phone Number"
                    placeholder="+1 (555) 000-0000"
                    value={phoneNumber}
                    onChange={(e) => setPhoneNumber(e.target.value)}
                    disabled={savingProfile}
                    leading={<Icon.Activity width={16} height={16} />}
                    helperText="Optional contact phone number"
                  />

                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel}>Assigned Role</label>
                    <div className={styles.readOnlyRoleBox}>
                      <div className={styles.readOnlyRoleLeft}>
                        <Icon.ShieldCheck width={16} height={16} className={styles.shieldIcon} />
                        <span className={styles.readOnlyRoleName}>
                          {user.isAdministrator ? 'Platform Administrator' : user.roleName || 'Normal User'}
                        </span>
                      </div>
                      <span className={styles.roleLockedTag}>
                        {isSuperAdmin ? 'Full System Access' : 'Managed Globally'}
                      </span>
                    </div>
                  </div>

                  <div className={styles.drawerFooter}>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={savingProfile}
                      onClick={closeDrawer}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="submit"
                      variant="primary"
                      loading={savingProfile}
                      leadingIcon={<Icon.CheckCircle width={16} height={16} />}
                    >
                      Save Profile Changes
                    </Button>
                  </div>
                </form>
              ) : (
                <ChangePasswordForm
                  onSuccess={() => { setDrawerOpen(false); triggerToast('Account password updated successfully.') }}
                  onCancel={closeDrawer}
                />
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
