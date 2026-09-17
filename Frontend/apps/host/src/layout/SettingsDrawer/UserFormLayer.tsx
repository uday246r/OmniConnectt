import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../features/auth/store/authStore'
import {
  usersApi,
  type CreateUserResponse,
  type PermissionOverrideDto,
} from '../../features/settings-users/api/usersApi'
import { rolesApi, type RoleListItemDto } from '../../features/settings-roles/api/rolesApi'
import { isApprovalPending, type ApprovalPendingDto } from '../../features/approvals/api/approvalsApi'
import { asPendingApprovalConflict, type PendingApprovalConflict } from '../../features/approvals/pendingConflict'
import { PendingApprovalDialog } from '../../features/approvals/components/PendingApprovalDialog'
import { useNavigationStore } from '../../shared/stores/navigationStore'
import { permissionsApi, type PermissionFeatureDto } from '../../shared/api/permissionsApi'
import { useSettingsDrawerStore } from '../../shared/stores/settingsDrawerStore'
import { useClickOutside } from '../../shared/hooks/useClickOutside'
import { Icon } from '../../shared/components/Icon/Icon'
import { SkeletonBlock } from '../../shared/components/Skeleton'
import { resolveIcon } from '../../shared/components/Icon/resolveIcon'
import { toast } from '../../shared/stores/toastStore'
import { validateFields, type FieldDefinition } from '@omniconnect/ui/validation'
import { isValid } from '../../shared/validation/rules'
import { userSchemaApi } from '../../features/settings-user-fields/api/userSchemaApi'
import { salutationsApi } from '../../features/settings-user-fields/api/salutationsApi'
import {
  groupsFromCatalog,
  columnsForRows,
  allGrantablePairs,
  pairId,
} from '../../shared/permissions/catalog'
import { CapabilityPicker } from '../../shared/permissions/CapabilityPicker'
import styles from './UserFormLayer.module.css'
import { TOPICS, invalidate } from '../../shared/stores/invalidationStore'
import { Select, Switch } from '@omniconnect/ui'

/*
 * Name/Email/Phone are no longer hardcoded here — they're the "core" entries of the admin-configurable
 * UserFieldSchema (see Settings > Manage Fields), rendered by the generic field loop below alongside
 * any custom fields (e.g. Aadhar Number) an admin has added. Their required-ness/validation rules come
 * from that schema; only Role/Status stay hardcoded, since those are access-control concerns the
 * schema deliberately never touches — see UserFieldSchema's doc comment on the backend.
 */

interface UserFormLayerProps {
  userId?: string
}

type Step = 'basic' | 'permissions' | 'review'

export function UserFormLayer({ userId }: UserFormLayerProps) {
  const isEdit = Boolean(userId)
  const accessToken = useAuthStore((s) => s.accessToken)
  // A token refresh must not re-run a load (and reset what the user is editing) — only its first arrival.
  const hasAccessToken = Boolean(accessToken)
  const ensureFreshAccessToken = useAuthStore((s) => s.ensureFreshAccessToken)
  const refreshSession = useAuthStore((s) => s.refreshSession)
  // Gates which roles this operator may hand out — see filteredRoles.
  const isAdministrator = Boolean(useAuthStore((s) => s.user)?.isAdministrator)
  const navigate = useNavigate()

  /*
   * Where to go once the form is done.
   *
   * Every exit here used to call `resetToRoot('users')`, which reopens the drawer on its Users tab —
   * except the drawer HAS no Users panel any more (Users became real pages, UsersPage /
   * UserDetailPage), so the tab body rendered blank. Saving a user dropped you on an empty settings
   * overlay and the record you had just edited was nowhere in sight.
   *
   * Closing and navigating instead puts you back on the page you came from: the detail view if you
   * hit Edit there, the list if you came from the list. Anything outside /settings/users falls back
   * to the list, which is the only sensible destination after creating a user.
   */
  const finish = () => {
    const { returnPath, close } = useSettingsDrawerStore.getState()
    close()
    navigate(returnPath.startsWith('/settings/users') ? returnPath : '/settings/users')
  }

  const [currentStep, setCurrentStep] = useState<Step>('basic')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdResult, setCreatedResult] = useState<CreateUserResponse | null>(null)
  // Set only on the CREATE path when Maker-Checker gates the "Users" module — the account doesn't
  // exist yet, so there's no temp password to show, just confirmation the request is queued.
  const [pendingApproval, setPendingApproval] = useState<ApprovalPendingDto | null>(null)
  const [approvalConflict, setApprovalConflict] = useState<PendingApprovalConflict | null>(null)

  // Step 1: Basic Fields — schema-driven (see Settings > Manage Fields). fieldValues holds one entry
  // per FieldDefinition key, core (name/email/phoneNumber) and custom alike.
  const [fields, setFields] = useState<FieldDefinition[]>([])
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({})
  const [salutationOptions, setSalutationOptions] = useState<string[]>([])
  const [salutation, setSalutation] = useState('')
  const [roleId, setRoleId] = useState<string>('')
  const [isActive, setIsActive] = useState(true)

  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false)
  const [roleSearch, setRoleSearch] = useState('')

  const roleDropdownRef = useRef<HTMLDivElement>(null)
  useClickOutside([roleDropdownRef], () => setRoleDropdownOpen(false), roleDropdownOpen)

  const [roles, setRoles] = useState<RoleListItemDto[]>([])

  const filteredRoles = useMemo(() => {
    /*
     * Administrator roles are only offered to administrators.
     *
     * Such a role grants unrestricted access to everything (PermissionClaimsBuilder short-circuits on
     * the flag), so letting anyone with Users:Edit hand one out is a complete privilege escalation —
     * and on a gated module it could be laundered through an unwitting non-admin checker. The server
     * refuses it either way (UserAppService.EnsureMayAssignRoleAsync); filtering here means a
     * non-admin is never shown an option that can only be rejected.
     *
     * The "administrator admin" search alias below is likewise scoped, so it can't surface a role
     * that has been filtered out of the list.
     */
    const assignable = isAdministrator ? roles : roles.filter((r) => !r.isAdministrator)

    if (!roleSearch.trim()) return assignable
    const q = roleSearch.toLowerCase().trim()
    return assignable.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.description && r.description.toLowerCase().includes(q)) ||
        (r.isAdministrator && 'administrator admin'.includes(q)),
    )
  }, [roles, roleSearch, isAdministrator])

  // Step 2: Permissions state
  const [rolePermissions, setRolePermissions] = useState<Set<string>>(new Set())
  const [selectedPermKeys, setSelectedPermKeys] = useState<Set<string>>(new Set())
  const [catalog, setCatalog] = useState<PermissionFeatureDto[]>([])

  const [expandedApps, setExpandedApps] = useState<Record<string, boolean>>({})
  const [permSearch, setPermSearch] = useState('')

  // Permissions calculation for Global and App-wise Select All directly from catalog
  /*
   * Grid shape from the catalog, exactly as in the role editor — see shared/permissions/catalog.ts for
   * why parent keys must never be granted directly.
   */
  const hostGroups = useMemo(() => groupsFromCatalog(catalog, 'Host'), [catalog])
  const hostColumns = useMemo(() => columnsForRows(hostGroups.flatMap((g) => g.rows)), [hostGroups])

  /*
   * Driven entirely by the CATALOG. It used to be joined against the remote-apps admin list for an
   * icon and a status badge, which made this editor require `host.settings.applications:View` — so an
   * administrator who could manage users but not applications got a 403 that emptied the whole apps
   * accordion. Users and applications are separate permissions on purpose.
   *
   * The icon comes from the navigation tree, already loaded for every authenticated user.
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

  const hostPermissions = useMemo(
    () =>
      hostGroups.flatMap((g) =>
        g.rows.flatMap((row) => row.capabilities.map((c) => ({ featureKey: row.key, capability: c.key }))),
      ),
    [hostGroups],
  )

  /**
   * Friendly label for a raw feature key — "Setup — User", not "host.settings.users". Feature keys
   * are internal permission-catalog identifiers with no reason to ever reach an operator; the review
   * step's Grant/Revoke override list previously rendered them verbatim.
   */
  const featureLabelsByKey = useMemo(() => {
    const map = new Map<string, string>()
    for (const group of [...hostGroups, ...appGroups]) {
      for (const row of group.rows) {
        map.set(row.key, row.isParent ? row.label : `${group.feature.displayName} — ${row.label}`)
      }
    }
    return map
  }, [hostGroups, appGroups])

  /**
   * Every grantable pair for one application, sub-modules included.
   *
   * Keyed by FEATURE key now, not app key. It previously rebuilt `remote.${appKey}` and read only the
   * parent's own capabilities — falling back to the registry's flat capability list when the parent
   * declared none. That fallback is what manufactured `remote.employee:View`.
   */
  const getAppPermissions = (featureKey: string) => {
    const group = appGroups.find((g) => g.feature.key === featureKey)
    if (!group) return []
    return group.rows.flatMap((row) =>
      row.capabilities.map((c) => ({ featureKey: row.key, capability: c.key })),
    )
  }

  /**
   * The universe this editor diffs against to derive Grant/Revoke overrides.
   *
   * MUST include sub-modules. `replaceOverrides` reconciles against exactly this list, so a pair that
   * never appears here is dropped by any unrelated edit — changing a user's phone number silently
   * removed their department permissions. The second pass over the registry's flat capability list is
   * gone: the catalog is the single authority, and reading the registry again risked disagreeing
   * with it.
   */
  const allGlobalPermissions = useMemo(() => allGrantablePairs(catalog), [catalog])

  /**
   * The set of permissions a role confers, as `featureKey:capability` ids.
   *
   * For an administrator role this is "everything in the catalog", enumerated the same recursive way —
   * the old version walked only top-level capabilities, so every sub-module looked UNGRANTED for an
   * administrator and a later save wrote a pile of spurious Revoke overrides against that account.
   */
  const fetchRolePermSet = async (
    targetRoleId: string,
    catalogData: PermissionFeatureDto[],
  ): Promise<Set<string>> => {
    if (!accessToken || !targetRoleId) return new Set()
    try {
      const roleDetail = await rolesApi.get(accessToken, targetRoleId)
      if (roleDetail.isAdministrator) {
        return new Set(allGrantablePairs(catalogData).map((p) => pairId(p.featureKey, p.capability)))
      }
      return new Set((roleDetail.permissions ?? []).map((p) => pairId(p.featureKey, p.capability)))
    } catch (err) {
      console.warn('Could not fetch role permissions', err)
      return new Set()
    }
  }

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false

    async function loadData() {
      try {
        const [rolesRes, catalogRes, schemaRes, salutationsRes] = await Promise.all([
          rolesApi.list(accessToken!, { pageSize: 100 }),
          permissionsApi.catalog(accessToken!),
          userSchemaApi.get(accessToken!),
          salutationsApi.get(accessToken!),
        ])

        if (cancelled) return
        setRoles(rolesRes.items)
        setCatalog(catalogRes)
        setSalutationOptions(salutationsRes.salutations)
        const sortedFields = [...schemaRes.fields].sort((a, b) => a.order - b.order)
        setFields(sortedFields)
        // Every field starts blank; a userId load below overwrites core + custom values on top.
        setFieldValues(Object.fromEntries(sortedFields.map((f) => [f.key, ''])))

        // Expand the first remote app by default.
        const firstApp = groupsFromCatalog(catalogRes, 'RemoteApp')[0]
        if (firstApp) {
          setExpandedApps({ [firstApp.feature.key]: true, host: true })
        }

        if (userId) {
          const [userRes, overridesRes] = await Promise.all([
            usersApi.get(accessToken!, userId),
            usersApi.getOverrides(accessToken!, userId).catch(() => []),
          ])

          if (cancelled) return
          setFieldValues((prev) => ({
            ...prev,
            name: userRes.name,
            email: userRes.email,
            phoneNumber: userRes.phoneNumber ?? '',
            ...(userRes.customFields ?? {}),
          }))
          setSalutation(userRes.salutation ?? '')
          setRoleId(userRes.roleId ?? '')
          setIsActive(userRes.isActive)

          let rolePermSet = new Set<string>()
          if (userRes.roleId) {
            rolePermSet = await fetchRolePermSet(userRes.roleId, catalogRes)
          }
          setRolePermissions(rolePermSet)

          // Effective checked = (Role permissions + Grants) - Revokes
          const effective = new Set(rolePermSet)
          overridesRes.forEach((o) => {
            const id = `${o.featureKey}:${o.capability}`
            if (o.effect === 'Grant') {
              effective.add(id)
            } else if (o.effect === 'Revoke') {
              effective.delete(id)
            }
          })
          setSelectedPermKeys(effective)
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Could not load user data.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadData()
    return () => {
      cancelled = true
    }
  }, [hasAccessToken, userId])

  const selectedRole = useMemo(() => {
    return roles.find((r) => r.id === roleId)
  }, [roles, roleId])

  // When changing role, pre-populate with the newly selected role's permissions
  const handleRoleChange = async (newRoleId: string) => {
    setRoleId(newRoleId)
    setTouched((t) => ({ ...t, role: true }))
    if (!accessToken || !newRoleId) {
      setRolePermissions(new Set())
      setSelectedPermKeys(new Set())
      return
    }

    try {
      const rolePermSet = await fetchRolePermSet(newRoleId, catalog)
      setRolePermissions(rolePermSet)
      // When role changes, pre-check all permissions of that role by default!
      setSelectedPermKeys(new Set(rolePermSet))
    } catch (err) {
      console.warn('Failed to load role permissions on role change', err)
    }
  }

  const toggleAppAccordion = (key: string) => {
    setExpandedApps((prev) => ({
      ...prev,
      [key]: !prev[key],
    }))
  }

  const isOverrideGranted = (featureKey: string, capability: string) => {
    return selectedPermKeys.has(`${featureKey}:${capability}`)
  }

  const toggleOverride = (featureKey: string, capability: string) => {
    const id = `${featureKey}:${capability}`
    setSelectedPermKeys((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const isAllGloballySelected = useMemo(() => {
    return (
      allGlobalPermissions.length > 0 &&
      allGlobalPermissions.every((p) => selectedPermKeys.has(`${p.featureKey}:${p.capability}`))
    )
  }, [allGlobalPermissions, selectedPermKeys])

  const handleToggleGlobalAll = (checked: boolean) => {
    if (checked) {
      setSelectedPermKeys(new Set(allGlobalPermissions.map((p) => `${p.featureKey}:${p.capability}`)))
    } else {
      setSelectedPermKeys(new Set())
    }
  }

  const isAppFullySelected = (items: { featureKey: string; capability: string }[]) => {
    return items.length > 0 && items.every((p) => selectedPermKeys.has(`${p.featureKey}:${p.capability}`))
  }

  const toggleAppAll = (items: { featureKey: string; capability: string }[], checked: boolean) => {
    setSelectedPermKeys((prev) => {
      const next = new Set(prev)
      items.forEach((it) => {
        const id = `${it.featureKey}:${it.capability}`
        if (checked) next.add(id)
        else next.delete(id)
      })
      return next
    })
  }

  // Compute exact diff overrides (Grants and Revokes) relative to assigned role
  const computedOverrides = useMemo(() => {
    const list: PermissionOverrideDto[] = []
    allGlobalPermissions.forEach((p) => {
      const id = `${p.featureKey}:${p.capability}`
      const isSelected = selectedPermKeys.has(id)
      const isRoleGranted = rolePermissions.has(id)

      if (isSelected && !isRoleGranted) {
        list.push({ featureKey: p.featureKey, capability: p.capability, effect: 'Grant' })
      } else if (!isSelected && isRoleGranted) {
        list.push({ featureKey: p.featureKey, capability: p.capability, effect: 'Revoke' })
      }
    })
    return list
  }, [allGlobalPermissions, selectedPermKeys, rolePermissions])

  const grantsList = useMemo(() => computedOverrides.filter((o) => o.effect === 'Grant'), [computedOverrides])
  const revokesList = useMemo(() => computedOverrides.filter((o) => o.effect === 'Revoke'), [computedOverrides])

  /**
   * Per-field validation mirroring the server's annotations on CreateUserRequest.
   *
   * Replaces a single check that only asked whether name and email were non-empty and reported one
   * combined sentence above the form. The deleted routed form had no validation at all, which is why
   * it accepted "989898989sssss" as a phone number and "ashok246@gmail.comsssssssss" as an email.
   *
   * The server validates independently; these exist so a problem is attached to the field that caused
   * it while the cursor is still in it.
   */
  const fieldErrors = validateFields(fields, fieldValues)

  // A role governs what the account can actually do, so leaving it unset ("No Role") is no longer an
  // acceptable end state — it's still selectable from the dropdown (an admin may genuinely be deciding),
  // but the wizard can't move past this step until something other than "No Role" is chosen.
  const roleError = roleId ? undefined : 'Assign a role before continuing.'

  // Shown once a field is visited or a submit attempted, so the form does not greet the user in red.
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [submitAttempted, setSubmitAttempted] = useState(false)
  const showError = (fieldKey: string) =>
    touched[fieldKey] || submitAttempted ? fieldErrors[fieldKey] : undefined
  const showRoleError = (touched.role || submitAttempted) && roleError

  const handleNextFromBasic = (e: FormEvent) => {
    e.preventDefault()
    setSubmitAttempted(true)
    if (!isValid(fieldErrors) || roleError) {
      setError(null)
      return
    }
    setError(null)
    setCurrentStep('permissions')
  }

  /**
   * Jumping directly to a later step via its badge used to only check `name && email` — the same two
   * fields the very first version of this form validated, before per-field rules (email format, phone
   * format, max lengths) existed. The Next button on Step 1 already enforces the full `fieldErrors`
   * set; a badge click bypassing that let an admin reach Review with an invalid phone number still in
   * the field, because nothing after Step 1 re-checks it.
   */
  const attemptJumpTo = (target: Step) => {
    if (target === 'basic') {
      setCurrentStep('basic')
      return
    }
    setSubmitAttempted(true)
    if (!isValid(fieldErrors) || roleError) {
      setError(null)
      return
    }
    setError(null)
    setCurrentStep(target)
  }

  const handleSubmit = async () => {
    setError(null)
    setSaving(true)

    try {
      const token = await ensureFreshAccessToken()
      const nameValue = (fieldValues.name ?? '').trim()
      const emailValue = (fieldValues.email ?? '').trim()
      const payloadPhoneNumber = (fieldValues.phoneNumber ?? '').trim() || null
      // Every non-core field's value — Aadhar Number, etc. — travels separately from the fixed
      // name/email/phoneNumber columns; see UserFieldSchema's "core vs custom" split.
      const customFields = Object.fromEntries(
        fields.filter((f) => !f.core).map((f) => [f.key, (fieldValues[f.key] ?? '').trim()]),
      )

      if (isEdit && userId) {
        // Core fields and Extra Permissions travel in ONE call now — a checker reviews and approves
        // both together, and approval actually applies both (previously the overrides half was a
        // separate follow-up call that got silently skipped whenever this one was gated).
        const result = await usersApi.update(
          token,
          userId,
          {
            name: nameValue,
            email: emailValue,
            phoneNumber: payloadPhoneNumber,
            roleId: roleId || null,
            // The toggle's value now actually reaches the server; it was previously dropped here.
            isActive,
            customFields,
            salutation: salutation || null,
          },
          computedOverrides,
        )

        if (isApprovalPending(result)) {
          toast.success(result.message)
          finish()
          return
        }

        // The acting admin may have just changed their own role or permissions, and the list behind
        // the drawer is now stale — without these the drawer closed onto old rows and only a full page
        // reload would show the change.
        void refreshSession()
        invalidate(TOPICS.users, TOPICS.approvals, TOPICS.kpis)
        toast.success(`User '${nameValue}' updated successfully.`)
        finish()
      } else {
        const res = await usersApi.create(
          token,
          {
            name: nameValue,
            email: emailValue,
            phoneNumber: payloadPhoneNumber,
            roleId: roleId || null,
            isActive,
            customFields,
            salutation: salutation || null,
          },
          computedOverrides,
        )

        if (isApprovalPending(res)) {
          // No account exists yet — nothing to list, but the overrides travelled with this same
          // request and will apply once it's approved and replayed.
          toast.success(res.message)
          setPendingApproval(res)
          return
        }

        invalidate(TOPICS.users, TOPICS.approvals, TOPICS.kpis)
        toast.success(`User '${res.user.name}' created successfully.`)
        setCreatedResult(res)
      }
    } catch (err: any) {
      // Blocked by an in-flight request on this same record — explained in a dialog rather than as a
      // form error, since nothing about the form input is wrong.
      const conflict = asPendingApprovalConflict(err)
      if (conflict) {
        setApprovalConflict(conflict)
        return
      }
      setError(err?.message || 'Could not save user.')
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className={styles.layer}>
        {/* Skeleton Header — mirrors real gradient header */}
        <div className={`${styles.header} ${styles.ufl1}`} >
          <div className={styles.headerTitleWrap}>
            <div className={`${styles.headerIconBox} ${styles.ufl2}`} >
              <SkeletonBlock width={22} height={22} radius="6px" />
            </div>
            <div className={styles.ufl3}>
              <SkeletonBlock width={160} height={16} radius="5px" />
              <SkeletonBlock width={230} height={12} radius="4px" />
            </div>
          </div>
          <div className={styles.ufl4} />
        </div>

        {/* Step badges skeleton */}
        <div className={styles.ufl5}>
          {[120, 140, 100].map((w, i) => (
            <SkeletonBlock key={i} width={w} height={32} radius="9px" />
          ))}
        </div>

        {/* Form card skeleton */}
        <div className={styles.ufl6}>
          {/* Card 1 — Basic details */}
          <div className={styles.ufl7}>
            <SkeletonBlock width={130} height={13} radius="4px" />
            <div className={styles.ufl8}>
              {/* Name + Email row */}
              <div className={styles.ufl9}>
                <div className={styles.ufl10}>
                  <SkeletonBlock width="40%" height={11} radius="3px" />
                  <SkeletonBlock width="100%" height={38} radius="9px" />
                </div>
                <div className={styles.ufl10}>
                  <SkeletonBlock width="40%" height={11} radius="3px" />
                  <SkeletonBlock width="100%" height={38} radius="9px" />
                </div>
              </div>
              {/* Phone + Role row */}
              <div className={styles.ufl9}>
                <div className={styles.ufl10}>
                  <SkeletonBlock width="40%" height={11} radius="3px" />
                  <SkeletonBlock width="100%" height={38} radius="9px" />
                </div>
                <div className={styles.ufl10}>
                  <SkeletonBlock width="35%" height={11} radius="3px" />
                  <SkeletonBlock width="100%" height={38} radius="9px" />
                </div>
              </div>
            </div>
          </div>

          {/* Card 2 — Account status */}
          <div className={styles.ufl11}>
            <div className={styles.ufl10}>
              <SkeletonBlock width={110} height={13} radius="4px" />
              <SkeletonBlock width={200} height={11} radius="3px" />
            </div>
            <SkeletonBlock width={44} height={24} radius="999px" />
          </div>
        </div>

        {/* Bottom bar skeleton */}
        <div className={`${styles.bottomBar} ${styles.ufl1}`} >
          <SkeletonBlock width={90} height={36} radius="9px" />
          <SkeletonBlock width={100} height={36} radius="9px" />
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
            <Icon.Users width={17} height={17} />
          </div>
          <div>
            <h2 className={styles.title}>{isEdit ? 'Edit User Account' : 'Create New User'}</h2>
            <p className={styles.subtitle}>
              {currentStep === 'basic' && 'Step 1 of 3: Account information & assigned role'}
              {currentStep === 'permissions' && 'Step 2 of 3: Granular application & module access'}
              {currentStep === 'review' && 'Step 3 of 3: Final confirmation & save'}
            </p>
          </div>
        </div>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={finish}
          aria-label="Close"
        >
          <Icon.X width={16} height={16} />
        </button>
      </div>

      {/* Modern Stepper Progress Navigation */}
      {!createdResult && !pendingApproval && (
        <div className={styles.stepperContainer}>
          {/* Step 1: Basic */}
          <button
            type="button"
            className={`${styles.stepTab} ${currentStep === 'basic' ? styles.stepTabActive : ''} ${currentStep !== 'basic' ? styles.stepTabDone : ''}`}
            onClick={() => setCurrentStep('basic')}
          >
            <div className={styles.stepBadge}>
              {currentStep !== 'basic' ? (
                <Icon.CheckCircle width={13} height={13} className={styles.stepCheckIcon} />
              ) : (
                <span>1</span>
              )}
            </div>
            <div className={styles.stepTabText}>
              <span className={styles.stepTitle}>Basic Details</span>
              <span className={styles.stepDesc}>Name, Email &amp; Role</span>
            </div>
          </button>

          <div className={`${styles.stepperLine} ${currentStep !== 'basic' ? styles.stepperLineDone : ''}`} />

          {/* Step 2: Permissions */}
          <button
            type="button"
            className={`${styles.stepTab} ${currentStep === 'permissions' ? styles.stepTabActive : ''} ${currentStep === 'review' ? styles.stepTabDone : ''}`}
            onClick={() => attemptJumpTo('permissions')}
          >
            <div className={styles.stepBadge}>
              {currentStep === 'review' ? (
                <Icon.CheckCircle width={13} height={13} className={styles.stepCheckIcon} />
              ) : (
                <span>2</span>
              )}
            </div>
            <div className={styles.stepTabText}>
              <span className={styles.stepTitle}>Extra Permissions</span>
              <span className={styles.stepDesc}>
                {selectedRole?.isAdministrator
                  ? 'Full Access (Administrator)'
                  : `${selectedPermKeys.size} Permissions Active`}
              </span>
            </div>
          </button>

          <div className={`${styles.stepperLine} ${currentStep === 'review' ? styles.stepperLineDone : ''}`} />

          {/* Step 3: Review */}
          <button
            type="button"
            className={`${styles.stepTab} ${currentStep === 'review' ? styles.stepTabActive : ''}`}
            onClick={() => attemptJumpTo('review')}
          >
            <div className={styles.stepBadge}>
              <span>3</span>
            </div>
            <div className={styles.stepTabText}>
              <span className={styles.stepTitle}>Review &amp; Save</span>
              <span className={styles.stepDesc}>Final Confirmation</span>
            </div>
          </button>
        </div>
      )}

      {error && <div className={styles.errorAlert}>{error}</div>}

      {pendingApproval ? (
        <div className={styles.successArea}>
          <div className={styles.successCard}>
            <div className={styles.successIconWrap}>
              <Icon.ShieldCheck width={42} height={42} />
            </div>
            <h3 className={styles.successTitle}>Request Submitted for Approval</h3>
            <p className={styles.successText}>
              Creating <strong>{[salutation, fieldValues.name].filter(Boolean).join(' ')}</strong> requires approval before the account exists.
              {pendingApproval.checkerName && pendingApproval.checkerName !== 'Unassigned'
                ? ` It's been assigned to ${pendingApproval.checkerName}.`
                : ''}{' '}
              Track its status any time from My Requests.
            </p>
            <button
              type="button"
              className={styles.doneBtn}
              onClick={() => finish()}
            >
              Done & Return to Users List
            </button>
          </div>
        </div>
            ) : createdResult ? (
        <div className={styles.successArea}>
          <div className={styles.successCard}>
            <div className={styles.successIconWrap}>
              <Icon.CheckCircle width={42} height={42} />
            </div>
            <h3 className={styles.successTitle}>User Account Created!</h3>

            {createdResult.inviteEmailed ? (
              /* ✅ Happy path — invite email delivered */
              <>
                <p className={styles.successText}>
                  An invitation email has been sent to{' '}
                  <strong>{[createdResult.user.salutation, createdResult.user.name].filter(Boolean).join(' ')}</strong>{' '}
                  at <strong>{createdResult.user.email}</strong>.
                </p>
                <p className={styles.successText}>
                  They will receive a secure link to set their own password and log in.
                  No further action is needed from you.
                </p>
              </>
            ) : (
              /* ⚠️ Email not sent — SMTP issue */
              <>
                <p className={styles.successText}>
                  The account for{' '}
                  <strong>{[createdResult.user.salutation, createdResult.user.name].filter(Boolean).join(' ')}</strong>{' '}
                  ({createdResult.user.email}) was created successfully.
                </p>
                <div className={styles.errorAlert} role="alert">
                  <strong>⚠️ Invitation email could not be sent.</strong> The user has no way to log
                  in until they receive an invitation link. Please check your SMTP configuration
                  and ask an administrator to resend the invite.
                </div>
              </>
            )}

            <button
              type="button"
              className={styles.doneBtn}
              onClick={() => finish()}
            >
              Done & Return to Users List
            </button>
          </div>
        </div>
      ) : (
        <div className={styles.formContainer}>
          <div className={styles.contentArea}>
            {/* STEP 1: Basic Info */}
            {currentStep === 'basic' && (
              <form id="basic-form" onSubmit={handleNextFromBasic} className={styles.formSection}>
                <div className={styles.formCard}>
                  <h4 className={styles.formCardTitle}>Personal Information</h4>
                  {/*
                   * Rendered entirely from the admin-configurable UserFieldSchema (Settings > Manage
                   * Fields) — Name/Email/Phone are its fixed "core" entries, and any custom field an
                   * admin adds (Aadhar Number, etc.) appears here the same way, in the order they chose.
                   * This replaced three hand-built inputs (including a country-code phone picker), so a
                   * plain text field is what every field gets now, core or custom alike.
                   */}
                  <div className={styles.fieldsGrid}>
                    {/* Salutation — like Role, a fixed dropdown backed by an admin-editable value list
                        (Settings > Manage Fields > Salutations), not part of UserFieldSchema itself. */}
                    <div className={styles.inputGroup}>
                      <label className={styles.label} htmlFor="user-form-salutation">Salutation</label>
                      <Select
                        id="user-form-salutation"
                        value={salutation}
                        onChange={(e) => setSalutation(e.target.value)}
                        placeholder="None"
                        clearLabel="None"
                        // A title since removed from the list stays selectable for the person who already has it.
                        options={(salutation && !salutationOptions.includes(salutation) ? [...salutationOptions, salutation] : salutationOptions).map((s) => ({ value: s, label: s }))}
                      />
                    </div>

                    {fields.map((field) => {
                      // Only the three core fields have a fixed, recognisable icon. A custom field
                      // (Aadhar Number, etc.) has no obvious icon to guess at, and reserving the icon's
                      // gutter space anyway just leaves an empty dent and an oddly-indented placeholder
                      // — so those get a plain input with no left padding instead.
                      const fieldIcon =
                        field.key === 'name' ? (
                          <Icon.Users width={16} height={16} className={styles.fieldLeftIcon} />
                        ) : field.key === 'email' ? (
                          <Icon.FileText width={16} height={16} className={styles.fieldLeftIcon} />
                        ) : field.key === 'phoneNumber' ? (
                          <Icon.Activity width={16} height={16} className={styles.fieldLeftIcon} />
                        ) : null

                      const input = (
                        <input
                          type={field.dataType === 'email' ? 'email' : 'text'}
                          className={`${fieldIcon ? styles.inputWithIcon : styles.input} ${showError(field.key) ? styles.inputInvalid : ''}`}
                          placeholder={field.key === 'phoneNumber' ? 'e.g. +91 98765 43210' : `Enter ${field.label}`}
                          value={fieldValues[field.key] ?? ''}
                          aria-invalid={Boolean(showError(field.key))}
                          aria-describedby={showError(field.key) ? `user-field-${field.key}-error` : undefined}
                          onChange={(e) => setFieldValues((prev) => ({ ...prev, [field.key]: e.target.value }))}
                          onBlur={() => setTouched((t) => ({ ...t, [field.key]: true }))}
                        />
                      )

                      return (
                        <div key={field.key} className={styles.inputGroup}>
                          <label className={styles.label}>
                            {field.label} {field.required && <span className={styles.req}>*</span>}
                          </label>
                          {fieldIcon ? (
                            <div className={styles.inputIconWrap}>
                              {input}
                              {fieldIcon}
                            </div>
                          ) : (
                            input
                          )}
                          {showError(field.key) && (
                            <span id={`user-field-${field.key}-error`} className={styles.fieldError} role="alert">
                              {showError(field.key)}
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div className={styles.formCard}>
                  <h4 className={styles.formCardTitle}>Assigned Role</h4>
                  <div className={styles.fieldsGrid}>
                    {/* Searchable Role Dropdown */}
                    <div className={styles.inputGroupFull}>
                      <label className={styles.label}>
                        Assigned System Role <span className={styles.req}>*</span>
                      </label>
                      <div className={styles.roleDropdownWrap} ref={roleDropdownRef}>
                        <button
                          type="button"
                          className={`${styles.rolePickerTrigger} ${roleDropdownOpen ? styles.rolePickerTriggerOpen : ''}`}
                          onClick={() => {
                            setRoleDropdownOpen(!roleDropdownOpen)
                            if (!roleDropdownOpen) setRoleSearch('')
                          }}
                          aria-haspopup="listbox"
                          aria-expanded={roleDropdownOpen}
                        >
                          <div className={styles.roleTriggerLeft}>
                            {selectedRole ? (
                              <>
                                <Icon.ShieldCheck width={15} height={15} className={styles.ufl12} />
                                <span className={styles.roleTriggerName}>{selectedRole.name}</span>
                                {selectedRole.isAdministrator && (
                                  <span className={styles.roleTriggerBadge}>Full Admin</span>
                                )}
                              </>
                            ) : (
                              <span className={styles.triggerPlaceholder}>-- Select a Role --</span>
                            )}
                          </div>
                          <Icon.ChevronDown
                            width={13}
                            height={13}
                            className={`${styles.triggerChevron} ${roleDropdownOpen ? styles.triggerChevronOpen : ''}`}
                          />
                        </button>

                        {roleDropdownOpen && (
                          <div className={styles.roleDropdownMenu} role="listbox">
                            <div className={styles.dropdownSearchWrap}>
                              <input
                                type="text"
                                className={styles.dropdownSearchInput}
                                placeholder="Type to search roles..."
                                value={roleSearch}
                                onChange={(e) => setRoleSearch(e.target.value)}
                                autoFocus
                              />
                              <Icon.Search width={12} height={12} className={styles.dropdownSearchIcon} />
                            </div>

                            <div className={styles.dropdownItemsList}>
                              {/* Option for No Role */}
                              <div
                                className={`${styles.dropdownItem} ${!roleId ? styles.dropdownItemSelected : ''}`}
                                role="option"
                                aria-selected={!roleId}
                                onClick={() => {
                                  void handleRoleChange('')
                                  setRoleDropdownOpen(false)
                                  setRoleSearch('')
                                }}
                              >
                                <div className={styles.dropdownItemLeft}>
                                  <span className={styles.dropdownName}>No Role (No Access Until Assigned)</span>
                                </div>
                                {!roleId && (
                                  <Icon.CheckCircle width={14} height={14} className={styles.dropdownCheckIcon} />
                                )}
                              </div>

                              {filteredRoles.length === 0 ? (
                                <div className={styles.dropdownEmpty}>No roles match &quot;{roleSearch}&quot;</div>
                              ) : (
                                filteredRoles.map((r) => {
                                  const isSelected = r.id === roleId
                                  return (
                                    <div
                                      key={r.id}
                                      className={`${styles.dropdownItem} ${isSelected ? styles.dropdownItemSelected : ''}`}
                                      role="option"
                                      aria-selected={isSelected}
                                      onClick={() => {
                                        void handleRoleChange(r.id)
                                        setRoleDropdownOpen(false)
                                        setRoleSearch('')
                                      }}
                                    >
                                      <div className={styles.roleItemInfo}>
                                        <div className={styles.roleItemHeader}>
                                          <span className={styles.roleItemName}>{r.name}</span>
                                          {r.isAdministrator && (
                                            <span className={styles.roleTriggerBadge}>Full Admin</span>
                                          )}
                                        </div>
                                        {r.description && (
                                          <span className={styles.roleItemDesc} title={r.description}>
                                            {r.description}
                                          </span>
                                        )}
                                      </div>
                                      {isSelected && (
                                        <Icon.CheckCircle width={14} height={14} className={styles.dropdownCheckIcon} />
                                      )}
                                    </div>
                                  )
                                })
                              )}
                            </div>
                          </div>
                        )}
                      </div>

                      {showRoleError && (
                        <span className={styles.fieldError} role="alert">
                          {roleError}
                        </span>
                      )}

                      {selectedRole?.isAdministrator && (
                        <div className={`${styles.adminRoleNotice} ${styles.ufl13}`} >
                          <Icon.ShieldCheck width={16} height={16} />
                          <span>This user will have full unrestricted Administrator capabilities across all applications.</span>
                        </div>
                      )}
                    </div>

                    <div className={styles.statusToggleCard}>
                      {/* Icon tile rather than a bare 5px bullet — same treatment as the role
                          editor's Platform Administrator card, carrying the on/off state in tint. */}
                      <div
                        className={`${styles.statusToggleIcon} ${isActive ? styles.statusToggleIconOn : ''}`}
                        aria-hidden="true"
                      >
                        <Icon.UserCheck width={17} height={17} />
                      </div>
                      <div className={styles.statusToggleInfo}>
                        <span className={styles.statusToggleTitle}>
                          {isActive ? 'Account is Active' : 'Account is Suspended'}
                        </span>
                        <span className={styles.statusToggleDesc}>
                          {isActive
                            ? 'User is permitted to sign in and interact with all granted applications.'
                            : 'User login is blocked until account is reactivated.'}
                        </span>
                      </div>
                      <Switch checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                    </div>
                  </div>
                </div>
              </form>
            )}

            {/* STEP 2: Extra Permissions */}
            {currentStep === 'permissions' && (
              <div className={styles.formSection}>
                {selectedRole?.isAdministrator ? (
                  /*
                   * Platform Administrator Access: the assigned role already grants everything (see
                   * fetchRolePermSet's admin branch — rolePermSet is every grantable pair in the
                   * catalog, and handleRoleChange pre-checks selectedPermKeys to match). Granular
                   * checkboxes/accordions here would only ever show every box already ticked, with no
                   * meaningful Grant/Revoke to make — showing them anyway invites an admin to think
                   * they're configuring something that unchecking wouldn't actually restrict, since a
                   * new capability the role gains later is still covered automatically. Hide the
                   * section entirely and say so plainly instead.
                   */
                  <div className={`${styles.adminRoleNotice} ${styles.ufl14}`} >
                    <Icon.ShieldCheck width={20} height={20} />
                    <span>
                      Platform Administrator has full access to all features and applications. Granular
                      permission selection is not applicable while this role is assigned.
                    </span>
                  </div>
                ) : (
                <>
                {/* Global Select All Toolbar */}
                <div className={styles.globalSelectToolbar}>
                  <label className={styles.globalCheckboxLabel}>
                    <input
                      type="checkbox"
                      className={styles.checkbox}
                      checked={isAllGloballySelected}
                      onChange={(e) => handleToggleGlobalAll(e.target.checked)}
                    />
                    <div className={styles.globalTextGroup}>
                      <span className={styles.globalSelectText}>
                        Select All Permissions Across Platform
                      </span>
                      <span className={styles.globalSelectSub}>
                        Grant all capabilities across host features and remote applications
                      </span>
                    </div>
                  </label>
                  <div className={styles.toolbarRightMeta}>
                    <span className={styles.selectedCountBadge}>
                      {selectedPermKeys.size} of {allGlobalPermissions.length} selected
                    </span>
                  </div>
                </div>

                {/* Filter Search Input */}
                <div className={styles.filterWrap}>
                  <input
                    type="text"
                    className={styles.filterInput}
                    placeholder="Filter permissions and applications..."
                    value={permSearch}
                    onChange={(e) => setPermSearch(e.target.value)}
                  />
                  <Icon.Search width={15} height={15} className={styles.filterIcon} />
                </div>

                <div className={styles.accordionList}>
                  {/* Host Core Permissions Accordion */}
                  {(!permSearch || 'host core platform'.includes(permSearch.toLowerCase())) && (
                    <div className={styles.accordionCard}>
                      <div
                        className={styles.accordionHeader}
                        onClick={() => toggleAppAccordion('host')}
                      >
                        <div className={styles.appTitleGroup}>
                          <div className={`${styles.appIconSmall} ${styles.iconHost}`}>
                            <Icon.ShieldCheck width={18} height={18} />
                          </div>
                          <div>
                            <span className={styles.accordionAppName}>Host Core Features</span>
                            <span className={styles.accordionAppKey}>Platform Administrative Modules</span>
                          </div>
                        </div>
                        <div className={styles.accordionRightMeta}>
                          {/* App-wise Select All */}
                          <label
                            className={styles.appSelectAllLabel}
                            onClick={(e) => e.stopPropagation()}
                          >
                            <input
                              type="checkbox"
                              className={styles.checkbox}
                              checked={isAppFullySelected(hostPermissions)}
                              onChange={(e) => toggleAppAll(hostPermissions, e.target.checked)}
                            />
                            <span>Select All</span>
                          </label>
                          {expandedApps['host'] ? (
                            <Icon.ChevronUp width={18} height={18} className={styles.chevron} />
                          ) : (
                            <Icon.ChevronDown width={18} height={18} className={styles.chevron} />
                          )}
                        </div>
                      </div>

                      {expandedApps['host'] && (
                        <div className={styles.accordionBody}>
                          <div className={styles.matrixTableWrap}>
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
                              {hostGroups
                                .flatMap((group) => group.rows)
                                .filter(
                                  (row) =>
                                    !permSearch ||
                                    row.label.toLowerCase().includes(permSearch.toLowerCase()) ||
                                    row.key.toLowerCase().includes(permSearch.toLowerCase()),
                                )
                                .map((row) => (
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
                                              checked={isOverrideGranted(row.key, declaredCap.key)}
                                              aria-label={`${col.displayName} on ${row.label}`}
                                              onChange={() => toggleOverride(row.key, declaredCap.key)}
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
                                ))}
                            </tbody>
                          </table>
                          </div>

                          <CapabilityPicker
                            rows={hostGroups.flatMap((g) => g.rows)}
                            isGranted={isOverrideGranted}
                            onToggle={toggleOverride}
                            emptyMessage="No host feature declares dashboard, export or panel capabilities."
                          />
                        </div>
                      )}
                    </div>
                  )}

                  {/* Remote Apps Accordions — rows and columns come from the catalog, which is
                      fetched with activeOnly. Disabling or deleting an app deactivates its permission
                      feature, so a withdrawn app is already absent here and needs no second filter. */}
                  {appGroups
                    .filter(
                      ({ feature }) =>
                        !permSearch ||
                        feature.displayName.toLowerCase().includes(permSearch.toLowerCase()) ||
                        feature.key.toLowerCase().includes(permSearch.toLowerCase()),
                    )
                    .map(({ feature, rows, columns, iconKey }) => {
                      const isExpanded = Boolean(expandedApps[feature.key])
                      const appPerms = getAppPermissions(feature.key)
                      const AppIcon = resolveIcon(iconKey)

                      return (
                        <div key={feature.key} className={styles.accordionCard}>
                          <div
                            className={styles.accordionHeader}
                            role="button"
                            tabIndex={0}
                            aria-expanded={isExpanded}
                            onClick={() => toggleAppAccordion(feature.key)}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter' || e.key === ' ') {
                                e.preventDefault()
                                toggleAppAccordion(feature.key)
                              }
                            }}
                          >
                            <div className={styles.appTitleGroup}>
                              <div className={`${styles.appIconSmall} ${styles.iconRemote}`}>
                                <AppIcon width={18} height={18} />
                              </div>
                              <div>
                                <span className={styles.accordionAppName}>{feature.displayName}</span>
                              </div>
                            </div>
                            <div className={styles.accordionRightMeta}>
                              <label
                                className={styles.appSelectAllLabel}
                                onClick={(e) => e.stopPropagation()}
                              >
                                <input
                                  type="checkbox"
                                  className={styles.checkbox}
                                  checked={isAppFullySelected(appPerms)}
                                  onChange={(e) => toggleAppAll(appPerms, e.target.checked)}
                                />
                                <span>Select All</span>
                              </label>
                              {isExpanded ? (
                                <Icon.ChevronUp width={18} height={18} className={styles.chevron} />
                              ) : (
                                <Icon.ChevronDown width={18} height={18} className={styles.chevron} />
                              )}
                            </div>
                          </div>

                          {isExpanded && (
                            <div className={styles.accordionBody}>
                              {/*
                               * No columns no longer means no capabilities. An app can declare only
                               * business capabilities — a dashboard-only module with KPIs and charts
                               * and no CRUD verb at all — and those have no columns by design. The
                               * "declared nothing" message would have hidden every one of them.
                               */}
                              {columns.length === 0 && rows.every((r) => r.capabilities.length === 0) ? (
                                <p className={styles.sectionHint}>
                                  This application hasn&rsquo;t declared any capabilities yet.
                                </p>
                              ) : columns.length === 0 ? null : (
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
                                                  checked={isOverrideGranted(row.key, declaredCap.key)}
                                                  aria-label={`${col.displayName} on ${row.label}`}
                                                  onChange={() => toggleOverride(row.key, declaredCap.key)}
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
                              )}

                              <CapabilityPicker
                                rows={rows}
                                isGranted={isOverrideGranted}
                                onToggle={toggleOverride}
                                emptyMessage="This application declares no dashboard, export or panel capabilities."
                              />
                            </div>
                          )}
                        </div>
                      )
                    })}
                </div>
                </>
                )}
              </div>
            )}

            {/* STEP 3: Review & Save */}
            {currentStep === 'review' && (
              <div className={styles.formSection}>
                <div className={styles.reviewCard}>
                  <div className={styles.reviewProfileHeader}>
                    <div className={styles.reviewAvatar}>
                      {(fieldValues.name || fieldValues.email || '?').charAt(0).toUpperCase()}
                    </div>
                    <div className={styles.reviewProfileDetails}>
                      <h4 className={styles.reviewProfileName}>{[salutation, fieldValues.name].filter(Boolean).join(' ')}</h4>
                      <span className={styles.reviewProfileEmail}>{fieldValues.email}</span>
                      <div className={styles.reviewPillsRow}>
                        <span className={styles.roleBadgePill}>
                          <Icon.ShieldCheck width={13} height={13} />
                          <span>{selectedRole ? selectedRole.name : 'No Role Assigned'}</span>
                        </span>
                        <span className={isActive ? styles.activeBadgeSmall : styles.inactiveBadgeSmall}>
                          <span className={isActive ? styles.badgeDotGreen : styles.badgeDotGray} />
                          <span>{isActive ? 'Active User' : 'Inactive User'}</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className={styles.reviewMetaList}>
                    <div className={styles.reviewMetaItem}>
                      <span className={styles.reviewMetaLabel}>Phone Number</span>
                      <span className={styles.reviewMetaVal}>{fieldValues.phoneNumber || 'None provided'}</span>
                    </div>
                    <div className={styles.reviewMetaItem}>
                      <span className={styles.reviewMetaLabel}>Administrator Privileges</span>
                      <span className={styles.reviewMetaVal}>
                        {selectedRole?.isAdministrator ? 'Yes (Full Platform Admin)' : 'Standard User'}
                      </span>
                    </div>
                    {/* Any admin-added custom field (Aadhar Number, etc.) — never Role/Status, which
                        stay outside UserFieldSchema entirely. */}
                    {fields.filter((f) => !f.core).map((f) => (
                      <div key={f.key} className={styles.reviewMetaItem}>
                        <span className={styles.reviewMetaLabel}>{f.label}</span>
                        <span className={styles.reviewMetaVal}>{fieldValues[f.key] || 'None provided'}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className={styles.reviewCard}>
                  <div className={styles.ufl15}>
                    <h4 className={`${styles.reviewCardTitle} ${styles.ufl16}`} >
                      Effective Capabilities ({selectedPermKeys.size})
                    </h4>
                    <span className={styles.ufl17}>
                      {grantsList.length > 0 && <strong className={styles.ufl18}>+{grantsList.length} Granted</strong>}
                      {revokesList.length > 0 && <strong className={styles.ufl19}>-{revokesList.length} Revoked</strong>}
                    </span>
                  </div>

                  {computedOverrides.length > 0 ? (
                    <div className={styles.ufl20}>
                      {grantsList.length > 0 && (
                        <div>
                          <span className={styles.ufl21}>
                            Extra Granted Overrides ({grantsList.length})
                          </span>
                          <div className={styles.overridesList}>
                            {grantsList.map((o, idx) => (
                              <div key={idx} className={styles.overrideTagGrant}>
                                <span className={styles.overrideKey}>{featureLabelsByKey.get(o.featureKey) ?? o.featureKey}</span>
                                <span className={styles.overrideDivider}>•</span>
                                <span className={styles.overrideCap}>+{o.capability}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {revokesList.length > 0 && (
                        <div>
                          <span className={styles.ufl22}>
                            Revoked Role Permissions ({revokesList.length})
                          </span>
                          <div className={styles.overridesList}>
                            {revokesList.map((o, idx) => (
                              <div key={idx} className={styles.overrideTagRevoke}>
                                <span className={styles.overrideKey}>{featureLabelsByKey.get(o.featureKey) ?? o.featureKey}</span>
                                <span className={styles.overrideDivider}>•</span>
                                <span className={styles.overrideCap}>-{o.capability}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className={`${styles.noOverridesCard} ${styles.ufl23}`} >
                      <Icon.Info width={18} height={18} className={styles.noOverridesIcon} />
                      <p className={styles.noOverridesText}>
                        No custom overrides added. The user will inherit all {rolePermissions.size} permissions dynamically configured under the <strong>{selectedRole ? selectedRole.name : 'assigned role'}</strong>.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Wizard Sticky Bottom Action Bar */}
          <div className={styles.bottomBar}>
            {currentStep === 'basic' && (
              <>
                <button type="button" className={styles.cancelBtn} onClick={finish}>
                  Cancel
                </button>
                <button
                  type="submit"
                  form="basic-form"
                  className={styles.primaryNextBtn}
                >
                  <span>Next: Permissions</span>
                  <Icon.ChevronRight width={16} height={16} />
                </button>
              </>
            )}

            {currentStep === 'permissions' && (
              <>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => setCurrentStep('basic')}
                >
                  <Icon.ChevronLeft width={16} height={16} />
                  <span>Back to Details</span>
                </button>
                <button
                  type="button"
                  className={styles.primaryNextBtn}
                  onClick={() => setCurrentStep('review')}
                >
                  <span>Next: Review & Confirm</span>
                  <Icon.ChevronRight width={16} height={16} />
                </button>
              </>
            )}

            {currentStep === 'review' && (
              <>
                <button
                  type="button"
                  className={styles.secondaryBtn}
                  onClick={() => setCurrentStep('permissions')}
                >
                  <Icon.ChevronLeft width={16} height={16} />
                  <span>Back to Permissions</span>
                </button>
                <button
                  type="button"
                  className={styles.saveBtn}
                  onClick={() => void handleSubmit()}
                  disabled={saving}
                >
                  {saving ? (
                    <span>Saving...</span>
                  ) : (
                    <>
                      <Icon.CheckCircle width={16} height={16} />
                      <span>{isEdit ? 'Save Changes' : 'Create User Account'}</span>
                    </>
                  )}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      <PendingApprovalDialog conflict={approvalConflict} onClose={() => setApprovalConflict(null)} />
    </div>
  )
}
