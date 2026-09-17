import { Fragment, useEffect, useMemo, useState, type FormEvent } from 'react'
import { useAuthStore } from '../../features/auth/store/authStore'
import { permissionsApi, type PermissionFeatureDto } from '../../shared/api/permissionsApi'
import { rolesApi, type RolePermissionGrantDto, type RoleUserDto } from '../../features/settings-roles/api/rolesApi'
import { isApprovalPending, type ApprovalPendingDto } from '../../features/approvals/api/approvalsApi'
import { asPendingApprovalConflict, type PendingApprovalConflict } from '../../features/approvals/pendingConflict'
import { PendingApprovalDialog } from '../../features/approvals/components/PendingApprovalDialog'
import { useNavigationStore } from '../../shared/stores/navigationStore'
import { useSettingsDrawerStore } from '../../shared/stores/settingsDrawerStore'
import { Icon } from '../../shared/components/Icon/Icon'
import { SkeletonBlock } from '../../shared/components/Skeleton'
import { resolveIcon } from '../../shared/components/Icon/resolveIcon'
import { groupsFromCatalog, columnsForRows } from '../../shared/permissions/catalog'
import { CapabilityPicker } from '../../shared/permissions/CapabilityPicker'
import { toast } from '../../shared/stores/toastStore'
import { LIMITS, required, maxLength, firstError, isValid, type FieldErrors } from '../../shared/validation/rules'
import styles from './RoleFormLayer.module.css'
import { TOPICS, invalidate } from '../../shared/stores/invalidationStore'
import { Switch } from '@omniconnect/ui'

interface RoleFormLayerProps {
  roleId?: string
  initialTab?: string
}

type TabType = 'basic' | 'host' | 'apps' | 'users'

const STEP_META: Record<TabType, { title: string; desc: string }> = {
  basic: { title: 'Basic Details', desc: 'Name & Admin Access' },
  host: { title: 'Host Permissions', desc: 'Platform Modules' },
  apps: { title: 'Application Access', desc: 'Remote Apps' },
  users: { title: 'Assigned Users', desc: 'Role Members' },
}

export function RoleFormLayer({ roleId, initialTab }: RoleFormLayerProps) {
  const isEdit = Boolean(roleId)
  const accessToken = useAuthStore((s) => s.accessToken)
  // A token refresh must not re-run a load (and reset what the user is editing) — only its first arrival.
  const hasAccessToken = Boolean(accessToken)
  const ensureFreshAccessToken = useAuthStore((s) => s.ensureFreshAccessToken)
  const refreshSession = useAuthStore((s) => s.refreshSession)
  const popLayer = useSettingsDrawerStore((s) => s.popLayer)

  const [activeTab, setActiveTab] = useState<TabType>((initialTab as TabType) || 'basic')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [approvalConflict, setApprovalConflict] = useState<PendingApprovalConflict | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [pendingApproval, setPendingApproval] = useState<ApprovalPendingDto | null>(null)

  // Form State
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [isAdministrator, setIsAdministrator] = useState(false)
  const [isSystemRole, setIsSystemRole] = useState(false)
  const [permissions, setPermissions] = useState<RolePermissionGrantDto[]>([])

  // Data
  const [catalog, setCatalog] = useState<PermissionFeatureDto[]>([])

  const [assignedUsers, setAssignedUsers] = useState<RoleUserDto[]>([])
  const [assignedUsersTotal, setAssignedUsersTotal] = useState(0)
  const [userSearch, setUserSearch] = useState('')
  const [appSearch, setAppSearch] = useState('')

  // Accordion expanded state for remote apps
  const [expandedApps, setExpandedApps] = useState<Record<string, boolean>>({})

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false

    async function loadData() {
      try {
        const catalogRes = await permissionsApi.catalog(accessToken!)

        if (cancelled) return
        setCatalog(catalogRes)

        // Expand the first remote app by default.
        const firstApp = groupsFromCatalog(catalogRes, 'RemoteApp')[0]
        if (firstApp) {
          setExpandedApps({ [firstApp.feature.key]: true })
        }

        if (roleId) {
          const [roleRes, usersRes] = await Promise.all([
            rolesApi.get(accessToken!, roleId),
            rolesApi.users(accessToken!, roleId),
          ])

          if (cancelled) return
          setName(roleRes.name)
          setDescription(roleRes.description ?? '')
          setIsAdministrator(roleRes.isAdministrator)
          setIsSystemRole(roleRes.isSystemRole)
          setPermissions(roleRes.permissions)
          setAssignedUsers(usersRes.items)
          setAssignedUsersTotal(usersRes.total)
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Could not load role details.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadData()
    return () => {
      cancelled = true
    }
  }, [hasAccessToken, roleId])

  /*
   * Grid shape comes from the catalog, never from a fixed list of verbs.
   *
   * Host columns are the union of what host features declare, so `users:Disable`,
   * `applications:Register`, `audit-logs:Export` and `profile:ChangePassword` each get a checkbox —
   * all four were previously ungrantable because the grid only had View/Create/Edit/Delete.
   */
  /*
   * Host Permissions and Application Access stay in the stepper even when Platform Administrator
   * Access is on — matching UserFormLayer's Extra Permissions step, which stays reachable for an
   * administrator user and shows a banner instead of disappearing. An administrator's grants have no
   * effect to configure (see isGranted/togglePermission below, both short-circuit on isAdministrator),
   * so each step renders an explanatory banner in place of interactive controls rather than vanishing.
   */
  const stepOrder: TabType[] = ['basic', 'host', 'apps', 'users']

  const currentStepIndex = stepOrder.indexOf(activeTab)
  const isLastStep = currentStepIndex === stepOrder.length - 1

  const hostGroups = useMemo(() => groupsFromCatalog(catalog, 'Host'), [catalog])
  const allHostPermissions = useMemo(
    () =>
      hostGroups.flatMap((g) =>
        g.rows.flatMap((row) =>
          row.capabilities.map((cap) => ({ featureKey: row.key, capability: cap.key })),
        ),
      ),
    [hostGroups],
  )

  const grantedHostPermsCount = useMemo(() => {
    if (isAdministrator) return allHostPermissions.length
    return allHostPermissions.filter((p) =>
      permissions.some((perm) => perm.featureKey === p.featureKey && perm.capability === p.capability),
    ).length
  }, [isAdministrator, allHostPermissions, permissions])

  const isAllHostSelected = useMemo(() => {
    if (isAdministrator) return true
    return allHostPermissions.length > 0 && grantedHostPermsCount === allHostPermissions.length
  }, [isAdministrator, allHostPermissions.length, grantedHostPermsCount])

  const handleToggleAllHost = (checked: boolean) => {
    if (isAdministrator) return
    const allHostKeys = new Set(allHostPermissions.map((p) => p.featureKey))
    setPermissions((prev) => {
      const appsOnly = prev.filter((p) => !allHostKeys.has(p.featureKey))
      if (checked) {
        return [...appsOnly, ...allHostPermissions]
      } else {
        return appsOnly
      }
    })
  }
  const hostColumns = useMemo(
    () => columnsForRows(hostGroups.flatMap((g) => g.rows)),
    [hostGroups],
  )

  /*
   * One group per remote application, driven entirely by the CATALOG.
   *
   * It used to be joined against the remote-apps admin list as well, for an icon and a status badge.
   * That made the role editor require `host.settings.applications:View` — so an administrator who
   * could edit roles but not manage applications got a 403 that emptied the whole apps accordion,
   * and adding a `.catch()` would only have made the emptiness silent. Roles and applications are
   * separate permissions on purpose; editing one must not require the other.
   *
   * The filter that went with it is gone too, and nothing replaces it: `permissionsApi.catalog`
   * defaults to `activeOnly`, and disabling or deleting an app deactivates its permission feature,
   * so a withdrawn app is already absent here. The status badge could only ever have read "Active".
   *
   * The icon comes from the navigation tree, which every authenticated user already has loaded. It
   * only covers apps this caller can see, so it degrades to the default for the rest — which is the
   * right trade for a decoration.
   */
  const navSections = useNavigationStore((s) => s.sections)

  const appGroups = useMemo(
    () =>
      groupsFromCatalog(catalog, 'RemoteApp').map((group) => ({
        ...group,
        iconKey: navSections
          .flatMap((s) => s.items)
          .find((n) => n.kind === 'remote-app' && n.key === group.feature.key)?.iconKey ?? null,
      })),
    [catalog, navSections],
  )

  const visibleAppGroups = appGroups

  const filteredAppGroups = useMemo(() => {
    if (!appSearch.trim()) return visibleAppGroups
    const q = appSearch.toLowerCase().trim()
    return visibleAppGroups.filter(({ feature, rows }) => {
      if (feature.displayName.toLowerCase().includes(q)) return true
      if (feature.key.toLowerCase().includes(q)) return true
      if (rows.some((r) => r.label.toLowerCase().includes(q) || r.key.toLowerCase().includes(q))) return true
      return false
    })
  }, [visibleAppGroups, appSearch])

  const allAppPermissions = useMemo(
    () =>
      visibleAppGroups.flatMap((g) =>
        g.rows.flatMap((row) =>
          row.capabilities.map((cap) => ({ featureKey: row.key, capability: cap.key })),
        ),
      ),
    [visibleAppGroups],
  )

  const grantedAppPermsCount = useMemo(() => {
    if (isAdministrator) return allAppPermissions.length
    return allAppPermissions.filter((p) =>
      permissions.some((perm) => perm.featureKey === p.featureKey && perm.capability === p.capability),
    ).length
  }, [isAdministrator, allAppPermissions, permissions])

  const isAllAppsSelected = useMemo(() => {
    if (isAdministrator) return true
    return allAppPermissions.length > 0 && grantedAppPermsCount === allAppPermissions.length
  }, [isAdministrator, allAppPermissions.length, grantedAppPermsCount])

  const handleToggleAllApps = (checked: boolean) => {
    if (isAdministrator) return
    const allAppKeys = new Set(allAppPermissions.map((p) => p.featureKey))
    setPermissions((prev) => {
      const hostOnly = prev.filter((p) => !allAppKeys.has(p.featureKey))
      if (checked) {
        return [...hostOnly, ...allAppPermissions]
      } else {
        return hostOnly
      }
    })
  }

  // Capability checking helpers
  const isGranted = (featureKey: string, capability: string) => {
    if (isAdministrator) return true
    return permissions.some((p) => p.featureKey === featureKey && p.capability === capability)
  }

  const togglePermission = (featureKey: string, capability: string) => {
    if (isAdministrator) return

    setPermissions((prev) => {
      const exists = prev.some((p) => p.featureKey === featureKey && p.capability === capability)
      if (exists) {
        return prev.filter((p) => !(p.featureKey === featureKey && p.capability === capability))
      } else {
        return [...prev, { featureKey, capability }]
      }
    })
  }

  const toggleAppAccordion = (key: string) => {
    setExpandedApps((prev) => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  const handleCollapseAll = () => {
    setExpandedApps({})
  }

  const isAppFullyGranted = (group: (typeof visibleAppGroups)[number]) => {
    if (isAdministrator) return true
    const perms = group.rows.flatMap((r) => r.capabilities.map((c) => ({ featureKey: r.key, capability: c.key })))
    if (perms.length === 0) return false
    return perms.every((p) => isGranted(p.featureKey, p.capability))
  }

  const toggleAppAll = (featureKey: string) => {
    if (isAdministrator) return
    const group = visibleAppGroups.find((g) => g.feature.key === featureKey)
    if (!group) return

    const appPerms = group.rows.flatMap((r) => r.capabilities.map((c) => ({ featureKey: r.key, capability: c.key })))
    const rowKeys = new Set(group.rows.map((r) => r.key))
    const currentlyAll = isAppFullyGranted(group)

    setPermissions((prev) => {
      const withoutThisApp = prev.filter((p) => !rowKeys.has(p.featureKey))
      if (currentlyAll) {
        return withoutThisApp
      } else {
        return [...withoutThisApp, ...appPerms]
      }
    })
  }

  /**
   * Per-field validation mirroring the server's annotations on UpsertRoleRequest, the same pattern
   * UserFormLayer uses. The old flat tab bar had no validation at all beyond the Name input's HTML5
   * `required` attribute, which only ever fires if the field sits inside a form that gets submitted —
   * true here only for the Basic step's own mini-form (see below), not for jumping straight to a later
   * tab, which is the gap this closes.
   */
  const fieldErrors: FieldErrors<'name' | 'description'> = {
    name: firstError(required(name, 'Role name'), maxLength(name, LIMITS.roleName, 'Role name')),
    description: maxLength(description, LIMITS.roleDescription, 'Description'),
  }

  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const showError = (field: keyof typeof fieldErrors) =>
    touched[field] || submitAttempted ? fieldErrors[field] : undefined

  const handleNextFromBasic = (e: FormEvent) => {
    e.preventDefault()
    setSubmitAttempted(true)
    if (!isValid(fieldErrors)) {
      setError(null)
      return
    }
    setError(null)
    setActiveTab(stepOrder[currentStepIndex + 1])
  }

  const goToPreviousStep = () => {
    if (currentStepIndex > 0) setActiveTab(stepOrder[currentStepIndex - 1])
  }

  /** Jumping directly to a later step badge is held to the same Basic-step validation as Next. */
  const attemptJumpTo = (target: TabType) => {
    const targetIndex = stepOrder.indexOf(target)
    if (targetIndex <= currentStepIndex || targetIndex === 0) {
      setActiveTab(target)
      return
    }
    setSubmitAttempted(true)
    if (!isValid(fieldErrors)) {
      setError(null)
      return
    }
    setError(null)
    setActiveTab(target)
  }

  const handleSubmit = async () => {
    setError(null)
    setSaving(true)

    try {
      const token = await ensureFreshAccessToken()
      const body = {
        name,
        description: description || null,
        isAdministrator,
        /*
         * Granular grants are PERSISTED even for an administrator role.
         *
         * This used to send `[]` whenever the administrator flag was on, which permanently destroyed
         * the role's configuration: switching a carefully built role to administrator and back left
         * every checkbox empty, with no warning and no way to recover it.
         *
         * Keeping them costs nothing and changes no access. PermissionClaimsBuilder short-circuits on
         * IsAdministrator and returns "unrestricted" without reading the grant rows at all, so the
         * effective permissions of an administrator are identical either way — the rows are simply
         * still there when the flag is turned back off.
         */
        permissions,
      }

      const result = isEdit && roleId ? await rolesApi.update(token, roleId, body) : await rolesApi.create(token, body)

      if (isApprovalPending(result)) {
        // Nothing was actually created/changed — the "Roles" module has a checker assigned, so this
        // submission is queued instead of applied. No refreshSession/invalidate: there is nothing
        // stale to refresh yet.
        if (isEdit) {
          // Mirrors UserFormLayer's own update path: the drawer just closes back to the list — there's
          // an existing role row to return to, so a dedicated interstitial screen adds nothing.
          toast.success(result.message)
          useSettingsDrawerStore.getState().resetToRoot('roles')
          return
        }

        // No role exists yet — nothing to attach anything to, and nothing to list. Mirrors
        // UserFormLayer's own create path: a dedicated "Submitted for Approval" screen instead of an
        // immediate close.
        toast.success(result.message)
        setPendingApproval(result)
        return
      }

      toast.success(`Role '${name}' ${isEdit ? 'updated' : 'created'} successfully.`)
      void refreshSession()
      invalidate(TOPICS.roles, TOPICS.approvals, TOPICS.kpis)
      useSettingsDrawerStore.getState().resetToRoot('roles')
    } catch (err: any) {
      // Blocked by an in-flight request on this same role — explained in a dialog rather than as a
      // form error, since nothing about the form input is wrong.
      const conflict = asPendingApprovalConflict(err)
      if (conflict) {
        setApprovalConflict(conflict)
        return
      }
      setError(err?.message || 'Could not save role.')
    } finally {
      setSaving(false)
    }
  }

  const filteredUsers = useMemo(() => {
    if (!userSearch) return assignedUsers
    const q = userSearch.toLowerCase()
    return assignedUsers.filter(
      (u) => u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    )
  }, [assignedUsers, userSearch])

  if (pendingApproval) {
    return (
      <div className={styles.layer}>
        <div className={styles.header}>
          <div className={styles.headerTitleWrap}>
            <div className={styles.headerIconBox}>
              <Icon.ShieldCheck width={20} height={20} />
            </div>
            <div>
              <h2 className={styles.title}>Create System Role</h2>
              <p className={styles.subtitle}>Define role scope, host permissions, and application access</p>
            </div>
          </div>
          <button type="button" className={styles.closeBtn} onClick={popLayer} aria-label="Close Role Editor">
            <Icon.X width={20} height={20} />
          </button>
        </div>
        <div className={styles.successArea}>
          <div className={styles.successCard}>
            <div className={styles.successIconWrap}>
              <Icon.ShieldCheck width={42} height={42} />
            </div>
            <h3 className={styles.successTitle}>Request Submitted for Approval</h3>
            <p className={styles.successText}>
              Creating <strong>{name}</strong> requires approval before the role exists.
              {pendingApproval.checkerName && pendingApproval.checkerName !== 'Unassigned'
                ? ` It's been assigned to ${pendingApproval.checkerName}.`
                : ''}{' '}
              Track its status any time from My Requests.
            </p>
            <button
              type="button"
              className={styles.doneBtn}
              onClick={() => useSettingsDrawerStore.getState().resetToRoot('roles')}
            >
              Done &amp; Return to Roles List
            </button>
          </div>
        </div>
      </div>
    )
  }

  if (loading) {
    return (
      <div className={styles.layer}>
        {/* Skeleton Header */}
        <div className={`${styles.header} ${styles.rfl1}`} >
          <div className={styles.headerTitleWrap}>
            <div className={`${styles.headerIconBox} ${styles.rfl2}`} >
              <SkeletonBlock width={22} height={22} radius="6px" />
            </div>
            <div className={styles.rfl3}>
              <SkeletonBlock width={140} height={16} radius="5px" />
              <SkeletonBlock width={210} height={12} radius="4px" />
            </div>
          </div>
          <div className={styles.rfl4} />
        </div>

        {/* Tab bar skeleton */}
        <div className={styles.rfl5}>
          {[80, 110, 90, 80].map((w, i) => (
            <div key={i} className={styles.rfl6}>
              <SkeletonBlock width={w} height={12} radius="4px" />
            </div>
          ))}
        </div>

        {/* Form body */}
        <div className={styles.rfl7}>
          {/* Card 1 — Basic fields */}
          <div className={styles.rfl8}>
            <SkeletonBlock width={120} height={13} radius="4px" />
            <div className={styles.rfl9}>
              <div className={styles.rfl10}>
                <SkeletonBlock width="30%" height={11} radius="3px" />
                <SkeletonBlock width="100%" height={38} radius="9px" />
              </div>
              <div className={styles.rfl10}>
                <SkeletonBlock width="35%" height={11} radius="3px" />
                <SkeletonBlock width="100%" height={66} radius="9px" />
              </div>
            </div>
          </div>

          {/* Card 2 — Permission matrix preview */}
          <div className={styles.rfl11}>
            <div className={styles.rfl12}>
              <SkeletonBlock width={140} height={13} radius="4px" />
              <div className={styles.rfl13}>
                {[60, 60, 60, 70].map((w, i) => (
                  <SkeletonBlock key={i} width={w} height={11} radius="3px" />
                ))}
              </div>
            </div>
            {[1, 2, 3].map((i) => (
              <div key={i} className={styles.rfl14}>
                <SkeletonBlock width="35%" height={12} radius="3px" />
                <div className={styles.rfl15}>
                  {[0, 1, 2, 3].map((j) => (
                    <SkeletonBlock key={j} width={16} height={16} radius="4px" />
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Card 3 — Admin toggle */}
          <div className={styles.rfl16}>
            <div className={styles.rfl10}>
              <SkeletonBlock width={130} height={13} radius="4px" />
              <SkeletonBlock width={220} height={11} radius="3px" />
            </div>
            <SkeletonBlock width={44} height={24} radius="999px" />
          </div>
        </div>

        {/* Bottom bar */}
        <div className={`${styles.bottomBar} ${styles.rfl1}`} >
          <SkeletonBlock width={90} height={36} radius="9px" />
          <SkeletonBlock width={110} height={36} radius="9px" />
        </div>
      </div>
    )
  }

  return (
    <div className={styles.layer}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerTitleWrap}>
          <div className={styles.headerIconBox}>
            <Icon.ShieldCheck width={17} height={17} />
          </div>
          <div>
            <h2 className={styles.title}>{isEdit ? 'Edit Role Definition' : 'Create System Role'}</h2>
            <p className={styles.subtitle}>Define role scope, host permissions, and application access</p>
          </div>
        </div>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={popLayer}
          aria-label="Close Role Editor"
        >
          <Icon.X width={16} height={16} />
        </button>
      </div>

      {/*
        Real stepper, matching UserFormLayer's — Next/Previous between steps, per-step validation, and
        the Create/Update button reachable only from the last step (see the bottom bar below). Replaces
        the previous flat tab bar, where every tab was independently clickable and Submit was always
        visible regardless of which tab was open, so a role could be created/saved without the admin
        ever having looked at Host Permissions or Application Access.

        Both permission steps stay reachable while the role is an administrator, matching
        UserFormLayer's Extra Permissions step — each renders an explanatory banner in place of the
        checkbox grid (an administrator holds every capability unconditionally, so the grid would be
        describing a choice that has no effect) rather than disappearing from the stepper. The
        underlying grants are kept (see handleSubmit's comment), so turning the flag back off restores
        exactly what was configured.
      */}
      <div className={styles.stepperContainer}>
        {stepOrder.map((step, idx) => {
          const meta = STEP_META[step]
          const isDone = idx < currentStepIndex
          const count =
            step === 'apps'
              ? visibleAppGroups.length
              : step === 'users'
              ? assignedUsersTotal
              : undefined
          return (
            <Fragment key={step}>
              <button
                type="button"
                className={`${styles.stepTab} ${activeTab === step ? styles.stepTabActive : ''} ${isDone ? styles.stepTabDone : ''}`}
                onClick={() => attemptJumpTo(step)}
              >
                <div className={styles.stepBadge}>
                  {isDone ? (
                    <Icon.CheckCircle width={13} height={13} className={styles.stepCheckIcon} />
                  ) : (
                    <span>{idx + 1}</span>
                  )}
                </div>
                <div className={styles.stepTabText}>
                  <span className={styles.stepTitle}>{meta.title}</span>
                  <span className={styles.stepDesc}>
                    {count !== undefined ? `${count} ${step === 'apps' ? 'Apps' : 'Members'}` : meta.desc}
                  </span>
                </div>
              </button>
              {idx < stepOrder.length - 1 && (
                <div className={`${styles.stepperLine} ${idx < currentStepIndex ? styles.stepperLineDone : ''}`} />
              )}
            </Fragment>
          )
        })}
      </div>

      {error && <div className={styles.errorAlert}>{error}</div>}

      {/* Form Content */}
      <div className={styles.form}>
        <div className={styles.contentArea}>
          {/* Tab 1: Basic Details */}
          {activeTab === 'basic' && (
            <form id="role-basic-form" onSubmit={handleNextFromBasic} className={styles.tabSection}>
              <div className={styles.formCard}>
                <h4 className={styles.formCardTitle}>Role Details</h4>
                <div className={styles.fieldsGrid}>
                  <div className={styles.inputGroupFull}>
                    <label className={styles.label}>
                      Role Name <span className={styles.req}>*</span>
                    </label>
                    <div className={styles.inputIconWrap}>
                      <input
                        type="text"
                        className={`${styles.inputWithIcon} ${showError('name') ? styles.inputInvalid : ''}`}
                        placeholder="e.g. Employee Operations Manager"
                        value={name}
                        maxLength={LIMITS.roleName}
                        aria-invalid={Boolean(showError('name'))}
                        aria-describedby={showError('name') ? 'role-name-error' : undefined}
                        onChange={(e) => setName(e.target.value)}
                        onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                      />
                      <Icon.ShieldCheck width={16} height={16} className={styles.fieldLeftIcon} />
                    </div>
                    {showError('name') && (
                      <span id="role-name-error" className={styles.fieldError} role="alert">
                        {showError('name')}
                      </span>
                    )}
                  </div>

                  <div className={styles.inputGroupFull}>
                    <label className={styles.label}>Role Description</label>
                    <textarea
                      className={styles.textarea}
                      placeholder="Briefly describe the operational scope and capabilities of this role..."
                      rows={3}
                      value={description}
                      maxLength={LIMITS.roleDescription}
                      onChange={(e) => setDescription(e.target.value)}
                      onBlur={() => setTouched((t) => ({ ...t, description: true }))}
                    />
                    {showError('description') && (
                      <span className={styles.fieldError} role="alert">
                        {showError('description')}
                      </span>
                    )}
                  </div>
                </div>
              </div>

              <div className={styles.adminToggleCard}>
                {/* An icon tile rather than the bare 5px dot this used to lead with, which read as a
                    stray bullet next to the heading rather than a state indicator. It carries the
                    same on/off signal in the tint, at a size that looks deliberate. */}
                <div
                  className={`${styles.adminToggleIcon} ${isAdministrator ? styles.adminToggleIconOn : ''}`}
                  aria-hidden="true"
                >
                  <Icon.ShieldCheck width={17} height={17} />
                </div>
                <div className={styles.adminToggleText}>
                  <span className={styles.toggleTitle}>Platform Administrator Access</span>
                  <span className={styles.toggleDesc}>
                    Grants full unrestricted access to all host features and remote applications, including future micro-frontends.
                  </span>
                </div>
                <Switch
                  checked={isAdministrator}
                  disabled={isSystemRole && isAdministrator}
                  onChange={(e) => setIsAdministrator(e.target.checked)}
                />
              </div>

              {/* Say plainly what turning this on means — Host Permissions and Application Access
                  stay reachable in the stepper (see stepOrder above), each showing this same banner
                  in place of its grid, matching UserFormLayer's Extra Permissions step. */}
              {isAdministrator && (
                <div className={styles.adminRoleBanner}>
                  <Icon.ShieldCheck width={20} height={20} />
                  <span>
                    Platform Administrator has full access to all features and applications. Host
                    Permissions and Application Access are already fully granted — granular selection
                    has no effect while this is enabled.
                  </span>
                </div>
              )}
            </form>
          )}

          {/* Tab 2: Host Permissions */}
          {activeTab === 'host' && (
            <div className={styles.tabSection}>
              <div className={styles.matrixCard}>
                <div className={styles.matrixHeader}>
                  <div>
                    <h4 className={styles.matrixTitle}>Platform Administrative Modules</h4>
                    <p className={styles.matrixSubtitle}>
                      Grant only the capabilities this role needs. Columns are exactly what each
                      feature declares, so a dash means the action does not exist for that feature.
                    </p>
                  </div>
                </div>

                {isAdministrator && (
                  <div className={styles.adminRoleBanner}>
                    <Icon.ShieldCheck width={20} height={20} />
                    <span>
                      Platform Administrator has full access to all features and applications. Every
                      capability below is already granted while this is enabled.
                    </span>
                  </div>
                )}

                <div className={styles.globalSelectToolbar}>
                  <label className={styles.globalCheckboxLabel}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={isAllHostSelected}
                      disabled={isAdministrator}
                      onChange={(e) => handleToggleAllHost(e.target.checked)}
                    />
                    <div className={styles.globalTextGroup}>
                      <span className={styles.globalSelectText}>
                        Select All Host Permissions
                      </span>
                      <span className={styles.globalSelectSub}>
                        Grant every capability across all host modules
                      </span>
                    </div>
                  </label>
                  <div className={styles.toolbarRightMeta}>
                    <span className={styles.selectedCountBadge}>
                      {grantedHostPermsCount} of {allHostPermissions.length} selected
                    </span>
                  </div>
                </div>

                <div className={styles.matrixTableWrap}>
                  {hostGroups.length === 0 ? (
                    <p className={styles.sectionHint}>The permission catalog is empty.</p>
                  ) : (
                    <table className={styles.matrixTable}>
                      <thead>
                        <tr>
                          <th className={styles.thFeature}>FEATURE / MODULE</th>
                          {hostColumns.map((col) => (
                            <th key={col.key} className={styles.thCap} title={col.displayName}>
                              {col.displayName.toUpperCase()}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {hostGroups.flatMap((group) =>
                          group.rows.map((row) => (
                            <tr key={row.key}>
                              <td className={styles.tdFeature}>
                                <span className={styles.featureName}>{row.label}</span>
                              </td>
                              {hostColumns.map((col) => {
                                const declaredCap = row.capabilities.find(
                                  (c) => c.key.toLowerCase() === col.key.toLowerCase(),
                                )
                                return (
                                  <td key={col.key} className={styles.tdCap}>
                                    {declaredCap ? (
                                      <input
                                        type="checkbox"
                                        className={styles.checkbox}
                                        checked={isGranted(row.key, declaredCap.key)}
                                        aria-label={`${col.displayName} on ${row.label}`}
                                        onChange={() => togglePermission(row.key, declaredCap.key)}
                                      />
                                    ) : (
                                      <span
                                        className={styles.capNotDeclared}
                                        title="Not applicable to this feature"
                                      >
                                        —
                                      </span>
                                    )}
                                  </td>
                                )
                              })}
                            </tr>
                          )),
                        )}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Host features declare none of these today, so this renders its empty state — but
                    it is here rather than app-only because nothing about the model stops a host
                    feature declaring one, and finding out the day it does is too late. */}
                <CapabilityPicker
                  rows={hostGroups.flatMap((g) => g.rows)}
                  isGranted={isGranted}
                  onToggle={togglePermission}
                  disabled={isAdministrator}
                  emptyMessage="No host feature declares dashboard, export or panel capabilities."
                />
              </div>
            </div>
          )}


          {/* Tab 3: Application Access */}
          {activeTab === 'apps' && (
            <div className={styles.tabSection}>
              {/* Same titled card band Host Permissions opens with, so both permission steps read as
                  the same screen rather than one card and one paragraph loose on the background. */}
              <div className={styles.stepHeaderCard}>
                <div className={styles.stepHeaderRow}>
                  <div className={styles.stepHeaderText}>
                    <h4 className={styles.matrixTitle}>Registered Application Modules</h4>
                    <p className={styles.matrixSubtitle}>
                      Rows and columns come from what each application itself reports, so a new
                      module or action appears here as soon as it is resynced.
                    </p>
                  </div>
                  <button type="button" className={styles.textActionBtn} onClick={handleCollapseAll}>
                    Collapse all
                  </button>
                </div>
              </div>

              {isAdministrator && (
                <div className={styles.adminRoleBanner}>
                  <Icon.ShieldCheck width={20} height={20} />
                  <span>
                    Platform Administrator has full access to all features and applications. Every
                    application's capabilities are already granted while this is enabled.
                  </span>
                </div>
              )}

              {/* Global Select All Toolbar for Remote Apps */}
              <div className={styles.globalSelectToolbar}>
                <label className={styles.globalCheckboxLabel}>
                  <input
                    type="checkbox"
                    className={styles.checkbox}
                    checked={isAllAppsSelected}
                    disabled={isAdministrator}
                    onChange={(e) => handleToggleAllApps(e.target.checked)}
                  />
                  <div className={styles.globalTextGroup}>
                    <span className={styles.globalSelectText}>
                      Select All Permissions Across Applications
                    </span>
                    <span className={styles.globalSelectSub}>
                      Grant all capabilities across all registered remote applications
                    </span>
                  </div>
                </label>
                <div className={styles.toolbarRightMeta}>
                  <span className={styles.selectedCountBadge}>
                    {grantedAppPermsCount} of {allAppPermissions.length} selected
                  </span>
                </div>
              </div>

              {/* Search & Filter Applications */}
              <div className={styles.filterWrap}>
                <input
                  type="text"
                  className={styles.filterInput}
                  placeholder="Filter applications and sub-modules..."
                  value={appSearch}
                  onChange={(e) => setAppSearch(e.target.value)}
                />
                <Icon.Search width={14} height={14} className={styles.filterIcon} />
              </div>

              <div className={styles.accordionList}>
                {visibleAppGroups.length === 0 && (
                  <p className={styles.sectionHint}>
                    No registered application has declared any permissions yet. Set a Permissions
                    Source URL on an application and resync it to populate this tab.
                  </p>
                )}

                {filteredAppGroups.length === 0 && visibleAppGroups.length > 0 && (
                  <p className={styles.sectionHint}>No applications match your search "{appSearch}".</p>
                )}

                {filteredAppGroups.map((group) => {
                  const { feature, rows, columns, iconKey } = group
                  const isExpanded = Boolean(expandedApps[feature.key])
                  const AppIcon = resolveIcon(iconKey)
                  const grantedCount = permissions.filter((p) =>
                    rows.some((r) => r.key === p.featureKey),
                  ).length
                  const isFullyGranted = isAppFullyGranted(group)

                  return (
                    <div key={feature.key} className={styles.accordionCard}>
                      <div
                        className={styles.accordionHeader}
                        role="button"
                        tabIndex={0}
                        aria-expanded={isExpanded}
                        onClick={() => toggleAppAccordion(feature.key)}
                        onKeyDown={(e) => {
                          // The header was a plain div, so an operator navigating by keyboard could
                          // not expand an application at all.
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            toggleAppAccordion(feature.key)
                          }
                        }}
                      >
                        <div className={styles.appTitleGroup}>
                          <div className={styles.appIconSmall}>
                            <AppIcon width={18} height={18} />
                          </div>
                          <div>
                            <span className={styles.accordionAppName}>{feature.displayName}</span>
                          </div>
                        </div>

                        <div className={styles.accordionRightMeta}>
                          {grantedCount > 0 && (
                            <span className={styles.grantCountBadge}>{grantedCount} granted</span>
                          )}
                          {isExpanded ? (
                            <Icon.ChevronUp width={18} height={18} className={styles.chevron} />
                          ) : (
                            <Icon.ChevronDown width={18} height={18} className={styles.chevron} />
                          )}
                        </div>
                      </div>

                      {isExpanded && (
                        <div className={styles.accordionBody}>
                          <div className={styles.selectRow}>
                            <span className={styles.appScopeLabel}>Declared Capabilities</span>
                            <button
                              type="button"
                              className={styles.selectLink}
                              onClick={() => toggleAppAll(feature.key)}
                            >
                              {isFullyGranted ? 'Deselect all' : 'Select all'}
                            </button>
                          </div>

                          <div className={styles.matrixTableWrap}>
                          <table className={styles.matrixTable}>
                            <thead>
                              <tr>
                                <th className={styles.thFeature}>SUB-MODULE / CAPABILITY</th>
                                {columns.map((col) => (
                                  <th key={col.key} className={styles.thCap} title={col.displayName}>
                                    {col.displayName.toUpperCase()}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {rows.map((row) => (
                                <tr key={row.key}>
                                  <td className={styles.tdFeature}>
                                    <span className={styles.featureName}>{row.label}</span>
                                  </td>
                                  {columns.map((col) => {
                                    const declaredCap = row.capabilities.find(
                                      (c) => c.key.toLowerCase() === col.key.toLowerCase(),
                                    )
                                    return (
                                      <td key={col.key} className={styles.tdCap}>
                                        {declaredCap ? (
                                          <input
                                            type="checkbox"
                                            className={styles.checkbox}
                                            checked={isGranted(row.key, declaredCap.key)}
                                            aria-label={`${col.displayName} on ${row.label}`}
                                            onChange={() => togglePermission(row.key, declaredCap.key)}
                                          />
                                        ) : (
                                          <span
                                            className={styles.capNotDeclared}
                                            title="Not declared by this module"
                                          >
                                            —
                                          </span>
                                        )}
                                      </td>
                                    )
                                  })}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          </div>

                          {/*
                           * The capabilities this app declares that are not CRUD verbs — its KPI
                           * cards, charts, exports and panels. They are grants exactly like the ones
                           * in the table above and produce the same permission string; they are
                           * shown separately only because one column each would leave the matrix
                           * mostly dashes.
                           */}
                          <CapabilityPicker
                            rows={rows}
                            isGranted={isGranted}
                            onToggle={togglePermission}
                            disabled={isAdministrator}
                            emptyMessage="This application declares no dashboard, export or panel capabilities."
                          />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            </div>
          )}


          {/* Tab 4: Assigned Users */}
          {activeTab === 'users' && (
            <div className={styles.tabSection}>
              {/* Header band lives INSIDE the table card, so the title, the search box and the rows
                  they describe read as one object instead of three stacked strips. */}
              <div className={styles.usersTableWrap}>
                <div className={styles.stepHeaderRow}>
                  <div className={styles.stepHeaderText}>
                    <h4 className={styles.matrixTitle}>Assigned Role Members ({assignedUsersTotal})</h4>
                    <p className={styles.matrixSubtitle}>
                      These users dynamically inherit all capabilities configured in this role.
                    </p>
                  </div>

                  <div className={styles.searchWrapSmall}>
                    <input
                      type="text"
                      className={styles.searchInputSmall}
                      placeholder="Search users..."
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                    />
                    <Icon.Search width={14} height={14} className={styles.searchIconSmall} />
                  </div>
                </div>

                <table className={styles.usersTable}>
                  <thead>
                    <tr>
                      <th>USER</th>
                      <th>EMAIL ADDRESS</th>
                      <th>STATUS</th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredUsers.length > 0 ? (
                      filteredUsers.map((u) => (
                        <tr key={u.id}>
                          <td>
                            <div className={styles.userCell}>
                              <span className={styles.userAvatar}>
                                {u.name.charAt(0).toUpperCase()}
                              </span>
                              <span className={styles.userNameText}>{u.name}</span>
                            </div>
                          </td>
                          <td className={styles.userEmailText}>{u.email}</td>
                          <td>
                            <span className={styles.activeBadgeSmall}>
                              <span className={styles.badgeDot} />
                              Active
                            </span>
                          </td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan={3} className={styles.emptyUsersCell}>
                          <div className={styles.emptyUsersIconBox}>
                            <Icon.Users width={20} height={20} />
                          </div>
                          <p className={styles.emptyUsersTitle}>
                            {isEdit ? 'No users assigned yet' : 'Nobody assigned yet'}
                          </p>
                          <p className={styles.emptyUsersDesc}>
                            {isEdit
                              ? 'Assign this role to a user from the Users tab and they will appear here.'
                              : 'Save this role first, then assign it to users from the Users tab.'}
                          </p>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Sticky Bottom Bar — Task 6: Next/Previous on every step except the last, where the only
            forward action is Create/Update. The API is never called before that final click: Next
            only ever calls setActiveTab (via handleNextFromBasic / attemptJumpTo), and handleSubmit is
            wired to nothing but this one button. */}
        <div className={styles.bottomBar}>
          {currentStepIndex === 0 ? (
            <>
              <button type="button" className={styles.cancelBtn} onClick={popLayer}>
                Cancel
              </button>
              <button type="submit" form="role-basic-form" className={styles.primaryNextBtn}>
                <span>Next: {STEP_META[stepOrder[1]].title}</span>
                <Icon.ChevronRight width={16} height={16} />
              </button>
            </>
          ) : (
            <>
              <button type="button" className={styles.secondaryBtn} onClick={goToPreviousStep}>
                <Icon.ChevronLeft width={16} height={16} />
                <span>Back to {STEP_META[stepOrder[currentStepIndex - 1]].title}</span>
              </button>
              {isLastStep ? (
                <button
                  type="button"
                  className={styles.saveBtn}
                  disabled={saving}
                  onClick={() => void handleSubmit()}
                >
                  {saving ? (
                    <span>Saving...</span>
                  ) : (
                    <>
                      <Icon.CheckCircle width={16} height={16} />
                      <span>{isEdit ? 'Save Changes' : 'Create System Role'}</span>
                    </>
                  )}
                </button>
              ) : (
                <button
                  type="button"
                  className={styles.primaryNextBtn}
                  onClick={() => setActiveTab(stepOrder[currentStepIndex + 1])}
                >
                  <span>Next: {STEP_META[stepOrder[currentStepIndex + 1]].title}</span>
                  <Icon.ChevronRight width={16} height={16} />
                </button>
              )}
            </>
          )}
        </div>
      </div>

      <PendingApprovalDialog conflict={approvalConflict} onClose={() => setApprovalConflict(null)} />
    </div>
  )
}
