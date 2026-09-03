import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../auth/store/authStore'
import { usersApi } from '../../settings-users/api/usersApi'
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
  // '?' rather than 'SA' — inventing initials shows an identity that may not be the viewer's own.
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
  const refreshSession = useAuthStore((s) => s.refreshSession)

  // Drawer state
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [activeTab, setActiveTab] = useState<DrawerTab>('profile')

  // Profile Form state
  const [name, setName] = useState(user?.name || '')
  const [email, setEmail] = useState(user?.email || '')
  const [phoneNumber, setPhoneNumber] = useState(user?.phoneNumber || '')
  const [savingProfile, setSavingProfile] = useState(false)
  const [profileError, setProfileError] = useState<string | null>(null)

  // Toast
  const [toastMessage, setToastMessage] = useState<string | null>(null)

  if (!user) return null

  const isGoogle = user.authProvider === 'Google'
  const isSuperAdmin = user.isAdministrator
  const initials = getUserInitials(user.name)

  function openDrawer(tab: DrawerTab = 'profile') {
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

    /*
     * Runs the same rules the Users form and the server use, rather than the name-only check this
     * previously had. Editing your own profile was the one place an invalid email or a malformed
     * phone number reached the API unchallenged and came back as a raw server error.
     *
     * Email is only editable by a Super Admin (see the payload below), so it is only checked when it
     * is actually being sent.
     */
    const problem = firstError(
      required(name, 'Full name'),
      isSuperAdmin ? emailRule(email) : undefined,
      // Optional here — the server accepts a null phone on update — so only validated when present.
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
        // Editing your own profile must never change your account status. Sending the current value
        // keeps this a no-op — omitting it would let the server default deactivate the account.
        isActive: user.isActive,
      })

      if (isApprovalPending(result)) {
        // Nothing was actually changed yet — the "Users" module has a checker assigned, so this edit
        // is queued instead of applied. No refreshSession(): there's nothing stale to pull yet, and
        // doing so here would silently overwrite the drawer's now-closed form with the OLD profile,
        // which could read as "my edit was discarded" rather than "it's pending".
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
            <div className={styles.avatar} aria-hidden="true">
              {initials}
            </div>
            <span className={styles.statusDot} />
          </div>

          <div className={styles.identityInfo}>
            <div className={styles.nameRow}>
              <h2 className={styles.name}>{user.name}</h2>
              <span className={styles.roleChip}>
                <Icon.ShieldCheck width={14} height={14} />
                <span>{user.isAdministrator ? 'Platform Administrator' : user.roleName || 'Authorized User'}</span>
              </span>
            </div>
            <p className={styles.email}>{user.email}</p>
          </div>
        </div>

        {/*
          Status badge only. The duplicate "Edit Profile" button that sat here has been removed — the
          page header already carries one, and the same action offered twice on one screen makes a
          reader stop and work out whether the two do the same thing.
        */}
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
            <div className={`${styles.cardHeaderIcon} ${styles.iconPurple}`}>
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

      {/* Row 3: Granted Capabilities & Permissions Card */}
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

        <div className={styles.capabilitiesGrid}>
          {user.isAdministrator ? (
            [
              { title: 'User Management', desc: 'Full authority to create, edit, deactivate, and assign role overrides to users.', icon: Icon.Users },
              { title: 'Role & RBAC Configuration', desc: 'Manage system roles, assign application scopes, and fine-tune permissions.', icon: Icon.ShieldCheck },
              { title: 'Micro-Frontend Registry', desc: 'Register, configure, and monitor Module Federation remote micro-frontends.', icon: Icon.Grid },
              { title: 'System Security Audit Trail', desc: 'Real-time visibility into authentication logs and administrative actions.', icon: Icon.FileText },
            ].map((cap, i) => (
              <div key={i} className={styles.capItem}>
                <div className={styles.capIconWrap}>
                  <cap.icon width={18} height={18} />
                </div>
                <div className={styles.capText}>
                  <span className={styles.capTitle}>{cap.title}</span>
                  <span className={styles.capDesc}>{cap.desc}</span>
                </div>
                <span className={styles.capActivePill}>Full Access</span>
              </div>
            ))
          ) : user.permissions && user.permissions.length > 0 ? (
            user.permissions.map((perm, i) => (
              <div key={i} className={styles.capItem}>
                <div className={styles.capIconWrap}>
                  <Icon.CheckCircle width={18} height={18} />
                </div>
                <div className={styles.capText}>
                  <span className={styles.capTitle}>{perm}</span>
                  <span className={styles.capDesc}>Active capability authorized for your account</span>
                </div>
                <span className={styles.capActivePill}>Authorized</span>
              </div>
            ))
          ) : (
            <div className={styles.emptyCapBox}>
              <span>Standard application access authorized via role.</span>
            </div>
          )}
        </div>
      </div>

      {/* Right Slide-Over Drawer */}
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
