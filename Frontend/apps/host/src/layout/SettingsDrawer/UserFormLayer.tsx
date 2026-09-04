import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
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
import { remoteAppsApi, type RemoteAppDto } from '../../features/settings-applications/api/remoteAppsApi'
import { permissionsApi, type PermissionFeatureDto } from '../../shared/api/permissionsApi'
import { useSettingsDrawerStore } from '../../shared/stores/settingsDrawerStore'
import { useClickOutside } from '../../shared/hooks/useClickOutside'
import { Icon } from '../../shared/components/Icon/Icon'
import { SkeletonBlock } from '../../shared/components/Skeleton'
import { resolveIcon } from '../../shared/components/Icon/resolveIcon'
import { toast } from '../../shared/stores/toastStore'
import {
  COUNTRY_PHONE_LIST,
  splitDialCode,
  validateCountryPhone,
} from '@omniremit/ui/validation'
import {
  LIMITS,
  required,
  maxLength,
  email as emailRule,
  firstError,
  isValid,
  type FieldErrors,
} from '../../shared/validation/rules'
import {
  groupsFromCatalog,
  columnsForRows,
  allGrantablePairs,
  pairId,
} from '../../shared/permissions/catalog'
import { CapabilityPicker } from '../../shared/permissions/CapabilityPicker'
import styles from './UserFormLayer.module.css'
import { TOPICS, invalidate } from '../../shared/stores/invalidationStore'
import { Switch } from '@omniremit/ui'

/*
 * Phone rules come from the shared package so the host, the remotes and (via the widened server
 * rules) the backends all judge a number the same way. This file previously carried its own copy of
 * the country table and validator, which is how the platform ended up with three incompatible
 * definitions of a valid phone number.
 */

interface UserFormLayerProps {
  userId?: string
}

type Step = 'basic' | 'permissions' | 'review'

export function UserFormLayer({ userId }: UserFormLayerProps) {
  const isEdit = Boolean(userId)
  const accessToken = useAuthStore((s) => s.accessToken)
  const ensureFreshAccessToken = useAuthStore((s) => s.ensureFreshAccessToken)
  const refreshSession = useAuthStore((s) => s.refreshSession)
  // Gates which roles this operator may hand out — see filteredRoles.
  const isAdministrator = Boolean(useAuthStore((s) => s.user)?.isAdministrator)
  const popLayer = useSettingsDrawerStore((s) => s.popLayer)

  const [currentStep, setCurrentStep] = useState<Step>('basic')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [createdResult, setCreatedResult] = useState<CreateUserResponse | null>(null)
  // Set only on the CREATE path when Maker-Checker gates the "Users" module — the account doesn't
  // exist yet, so there's no temp password to show, just confirmation the request is queued.
  const [pendingApproval, setPendingApproval] = useState<ApprovalPendingDto | null>(null)
  const [approvalConflict, setApprovalConflict] = useState<PendingApprovalConflict | null>(null)

  // Step 1: Basic Fields
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [selectedCountryCode, setSelectedCountryCode] = useState('IN')
  const [countryDropdownOpen, setCountryDropdownOpen] = useState(false)
  const [countrySearch, setCountrySearch] = useState('')
  const [nationalPhone, setNationalPhone] = useState('')
  const [roleId, setRoleId] = useState<string>('')
  const [isActive, setIsActive] = useState(true)

  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false)
  const [roleSearch, setRoleSearch] = useState('')

  const countryDropdownRef = useRef<HTMLDivElement>(null)
  useClickOutside([countryDropdownRef], () => setCountryDropdownOpen(false), countryDropdownOpen)

  const roleDropdownRef = useRef<HTMLDivElement>(null)
  useClickOutside([roleDropdownRef], () => setRoleDropdownOpen(false), roleDropdownOpen)

  const filteredCountries = useMemo(() => {
    if (!countrySearch.trim()) return COUNTRY_PHONE_LIST
    const q = countrySearch.toLowerCase().trim()
    return COUNTRY_PHONE_LIST.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.code.toLowerCase().includes(q) ||
        c.dialCode.toLowerCase().includes(q) ||
        c.dialCode.replace('+', '').includes(q),
    )
  }, [countrySearch])

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
  const [remoteApps, setRemoteApps] = useState<RemoteAppDto[]>([])
  const [expandedApps, setExpandedApps] = useState<Record<string, boolean>>({})
  const [permSearch, setPermSearch] = useState('')

  // Permissions calculation for Global and App-wise Select All directly from catalog
  /*
   * Grid shape from the catalog, exactly as in the role editor — see shared/permissions/catalog.ts for
   * why parent keys must never be granted directly.
   */
  const hostGroups = useMemo(() => groupsFromCatalog(catalog, 'Host'), [catalog])
  const hostColumns = useMemo(() => columnsForRows(hostGroups.flatMap((g) => g.rows)), [hostGroups])

  const appGroups = useMemo(
    () =>
      groupsFromCatalog(catalog, 'RemoteApp').map((group) => ({
        ...group,
        app: remoteApps.find((a) => `remote.${a.key}` === group.feature.key),
      })),
    [catalog, remoteApps],
  )

  const hostPermissions = useMemo(
    () =>
      hostGroups.flatMap((g) =>
        g.rows.flatMap((row) => row.capabilities.map((c) => ({ featureKey: row.key, capability: c.key }))),
      ),
    [hostGroups],
  )

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
        const [rolesRes, catalogRes, appsRes] = await Promise.all([
          rolesApi.list(accessToken!, { pageSize: 100 }),
          permissionsApi.catalog(accessToken!),
          remoteAppsApi.list(accessToken!, { pageSize: 100 }),
        ])

        if (cancelled) return
        setRoles(rolesRes.items)
        setCatalog(catalogRes)
        setRemoteApps(appsRes.items)

        // Expand first remote app by default
        if (appsRes.items.length > 0) {
          setExpandedApps({ [`remote.${appsRes.items[0].key}`]: true, host: true })
        }

        if (userId) {
          const [userRes, overridesRes] = await Promise.all([
            usersApi.get(accessToken!, userId),
            usersApi.getOverrides(accessToken!, userId).catch(() => []),
          ])

          if (cancelled) return
          setName(userRes.name)
          setEmail(userRes.email)
          const parsed = splitDialCode(userRes.phoneNumber ?? '')
          setSelectedCountryCode(parsed.countryCode)
          setNationalPhone(parsed.nationalNumber)
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
  }, [accessToken, userId])

  const selectedRole = useMemo(() => {
    return roles.find((r) => r.id === roleId)
  }, [roles, roleId])

  const selectedCountry = useMemo(() => {
    return COUNTRY_PHONE_LIST.find((c) => c.code === selectedCountryCode) || COUNTRY_PHONE_LIST[0]
  }, [selectedCountryCode])

  const fullPhoneNumber = useMemo(() => {
    if (!nationalPhone.trim()) return ''
    return `${selectedCountry.dialCode} ${nationalPhone.trim()}`
  }, [selectedCountry.dialCode, nationalPhone])

  // When changing role, pre-populate with the newly selected role's permissions
  const handleRoleChange = async (newRoleId: string) => {
    setRoleId(newRoleId)
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
  const fieldErrors: FieldErrors<'name' | 'email' | 'phoneNumber'> = {
    name: firstError(required(name, 'Full name'), maxLength(name, LIMITS.userName, 'Full name')),
    email: firstError(required(email, 'Email address'), emailRule(email), maxLength(email, LIMITS.email, 'Email address')),
    phoneNumber: firstError(validateCountryPhone(nationalPhone, selectedCountry)),
  }

  // Shown once a field is visited or a submit attempted, so the form does not greet the user in red.
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
    if (!isValid(fieldErrors)) {
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
      const payloadPhoneNumber = nationalPhone.trim()
        ? `${selectedCountry.dialCode} ${nationalPhone.trim()}`
        : null

      if (isEdit && userId) {
        // Core fields and Extra Permissions travel in ONE call now — a checker reviews and approves
        // both together, and approval actually applies both (previously the overrides half was a
        // separate follow-up call that got silently skipped whenever this one was gated).
        const result = await usersApi.update(
          token,
          userId,
          {
            name: name.trim(),
            email: email.trim(),
            phoneNumber: payloadPhoneNumber,
            roleId: roleId || null,
            // The toggle's value now actually reaches the server; it was previously dropped here.
            isActive,
          },
          computedOverrides,
        )

        if (isApprovalPending(result)) {
          toast.success(result.message)
          useSettingsDrawerStore.getState().resetToRoot('users')
          return
        }

        // The acting admin may have just changed their own role or permissions, and the list behind
        // the drawer is now stale — without these the drawer closed onto old rows and only a full page
        // reload would show the change.
        void refreshSession()
        invalidate(TOPICS.users, TOPICS.approvals)
        toast.success(`User '${name}' updated successfully.`)
        useSettingsDrawerStore.getState().resetToRoot('users')
      } else {
        const res = await usersApi.create(
          token,
          {
            name: name.trim(),
            email: email.trim(),
            phoneNumber: payloadPhoneNumber,
            roleId: roleId || null,
            isActive,
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

        invalidate(TOPICS.users, TOPICS.approvals)
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
          onClick={popLayer}
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
              Creating <strong>{name}</strong> requires approval before the account exists.
              {pendingApproval.checkerName && pendingApproval.checkerName !== 'Unassigned'
                ? ` It's been assigned to ${pendingApproval.checkerName}.`
                : ''}{' '}
              Track its status any time from My Requests.
            </p>
            <button
              type="button"
              className={styles.doneBtn}
              onClick={() => useSettingsDrawerStore.getState().resetToRoot('users')}
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
            <p className={styles.successText}>
              Share this temporary password securely with <strong>{createdResult.user.name}</strong> ({createdResult.user.email}). It will not be visible again once closed.
            </p>
            <div className={styles.tempPassBox}>
              <span className={styles.tempPassLabel}>Temporary Password</span>
              <code>{createdResult.temporaryPassword}</code>
            </div>
            <button
              type="button"
              className={styles.doneBtn}
              onClick={() => useSettingsDrawerStore.getState().resetToRoot('users')}
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
                  <div className={styles.fieldsGrid}>
                    <div className={styles.inputGroup}>
                      <label className={styles.label}>
                        Full Name <span className={styles.req}>*</span>
                      </label>
                      <div className={styles.inputIconWrap}>
                        <input
                          type="text"
                          className={`${styles.inputWithIcon} ${showError('name') ? styles.inputInvalid : ''}`}
                          placeholder="e.g. Jane Smith"
                          value={name}
                          maxLength={LIMITS.userName}
                          aria-invalid={Boolean(showError('name'))}
                          aria-describedby={showError('name') ? 'user-name-error' : undefined}
                          onChange={(e) => setName(e.target.value)}
                          onBlur={() => setTouched((t) => ({ ...t, name: true }))}
                        />
                        <Icon.Users width={16} height={16} className={styles.fieldLeftIcon} />
                      </div>
                      {showError('name') && (
                        <span id="user-name-error" className={styles.fieldError} role="alert">
                          {showError('name')}
                        </span>
                      )}
                    </div>

                    <div className={styles.inputGroup}>
                      <label className={styles.label}>
                        Email Address <span className={styles.req}>*</span>
                      </label>
                      <div className={styles.inputIconWrap}>
                        <input
                          type="email"
                          className={`${styles.inputWithIcon} ${showError('email') ? styles.inputInvalid : ''}`}
                          placeholder="e.g. jane.smith@example.com"
                          value={email}
                          maxLength={LIMITS.email}
                          aria-invalid={Boolean(showError('email'))}
                          aria-describedby={showError('email') ? 'user-email-error' : undefined}
                          onChange={(e) => setEmail(e.target.value)}
                          onBlur={() => setTouched((t) => ({ ...t, email: true }))}
                        />
                        <Icon.FileText width={16} height={16} className={styles.fieldLeftIcon} />
                      </div>
                      {showError('email') && (
                        <span id="user-email-error" className={styles.fieldError} role="alert">
                          {showError('email')}
                        </span>
                      )}
                    </div>

                    <div className={styles.inputGroupFull}>
                      <label className={styles.label}>
                        Phone Number <span className={styles.req}>*</span>
                      </label>
                      <div className={styles.phoneInputRow}>
                        {/* Custom Searchable Country Code Dropdown */}
                        <div className={styles.countryPickerWrap} ref={countryDropdownRef}>
                          <button
                            type="button"
                            className={`${styles.countryPickerTrigger} ${countryDropdownOpen ? styles.countryPickerTriggerOpen : ''}`}
                            onClick={() => {
                              setCountryDropdownOpen(!countryDropdownOpen)
                              if (!countryDropdownOpen) setCountrySearch('')
                            }}
                            aria-haspopup="listbox"
                            aria-expanded={countryDropdownOpen}
                            aria-label={`Selected country: ${selectedCountry.name}, code ${selectedCountry.dialCode}`}
                          >
                            <div className={styles.countryTriggerLeft}>
                              <span>{selectedCountry.flag}</span>
                              <span className={styles.countryTriggerDial}>{selectedCountry.dialCode}</span>
                            </div>
                            <Icon.ChevronDown
                              width={12}
                              height={12}
                              className={`${styles.triggerChevron} ${countryDropdownOpen ? styles.triggerChevronOpen : ''}`}
                            />
                          </button>

                          {countryDropdownOpen && (
                            <div className={styles.countryDropdownMenu} role="listbox">
                              <div className={styles.dropdownSearchWrap}>
                                <input
                                  type="text"
                                  className={styles.dropdownSearchInput}
                                  placeholder="Search country or code..."
                                  value={countrySearch}
                                  onChange={(e) => setCountrySearch(e.target.value)}
                                  autoFocus
                                />
                                <Icon.Search width={12} height={12} className={styles.dropdownSearchIcon} />
                              </div>

                              <div className={styles.dropdownItemsList}>
                                {filteredCountries.length === 0 ? (
                                  <div className={styles.dropdownEmpty}>No countries match &quot;{countrySearch}&quot;</div>
                                ) : (
                                  filteredCountries.map((c) => {
                                    const isSelected = c.code === selectedCountryCode
                                    return (
                                      <div
                                        key={c.code}
                                        className={`${styles.dropdownItem} ${isSelected ? styles.dropdownItemSelected : ''}`}
                                        role="option"
                                        aria-selected={isSelected}
                                        onClick={() => {
                                          setSelectedCountryCode(c.code)
                                          setCountryDropdownOpen(false)
                                          setCountrySearch('')
                                          setTouched((t) => ({ ...t, phoneNumber: true }))
                                        }}
                                      >
                                        <div className={styles.dropdownItemLeft}>
                                          <span>{c.flag}</span>
                                          <span className={styles.dropdownItemName} title={c.name}>
                                            {c.name}
                                          </span>
                                        </div>
                                        <span className={styles.dropdownItemDial}>{c.dialCode}</span>
                                      </div>
                                    )
                                  })
                                )}
                              </div>
                            </div>
                          )}
                        </div>

                        <div className={styles.nationalPhoneWrap}>
                          <input
                            type="tel"
                            className={`${styles.inputWithIcon} ${showError('phoneNumber') ? styles.inputInvalid : ''}`}
                            placeholder={`e.g. ${selectedCountry.placeholder}`}
                            value={nationalPhone}
                            maxLength={LIMITS.phone}
                            aria-invalid={Boolean(showError('phoneNumber'))}
                            aria-describedby={showError('phoneNumber') ? 'user-phone-error' : undefined}
                            onChange={(e) => setNationalPhone(e.target.value)}
                            onBlur={() => setTouched((t) => ({ ...t, phoneNumber: true }))}
                          />
                          <Icon.Activity width={16} height={16} className={styles.fieldLeftIcon} />
                        </div>
                      </div>
                      {showError('phoneNumber') && (
                        <span id="user-phone-error" className={styles.fieldError} role="alert">
                          {showError('phoneNumber')}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className={styles.formCard}>
                  <h4 className={styles.formCardTitle}>Assigned Role</h4>
                  <div className={styles.fieldsGrid}>
                    {/* Searchable Role Dropdown */}
                    <div className={styles.inputGroupFull}>
                      <label className={styles.label}>Assigned System Role</label>
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
                              <span className={styles.triggerPlaceholder}>-- No Role (Inherit Standard Access) --</span>
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
                                  <span className={styles.dropdownName}>-- No Role (Inherit Standard Access) --</span>
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

                      {selectedRole?.isAdministrator && (
                        <div className={`${styles.adminRoleNotice} ${styles.ufl13}`} >
                          <Icon.ShieldCheck width={16} height={16} />
                          <span>This user will have full unrestricted Administrator capabilities across all applications.</span>
                        </div>
                      )}
                    </div>

                    <div className={styles.statusToggleCard}>
                      <div className={styles.statusToggleInfo}>
                        <div className={styles.statusToggleHeader}>
                          <span className={isActive ? styles.badgeDotGreen : styles.badgeDotGray} />
                          <span className={styles.statusToggleTitle}>
                            {isActive ? 'Account is Active' : 'Account is Suspended'}
                          </span>
                        </div>
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
                                <th>FEATURE / MODULE</th>
                                {hostColumns.map((col) => (
                                  <th key={col.key} title={col.displayName}>
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
                                    <td>
                                      <span className={styles.featureName}>{row.label}</span>
                                    </td>
                                    {hostColumns.map((col) => {
                                      const declaredCap = row.capabilities.find(
                                        (c) => c.key.toLowerCase() === col.key.toLowerCase(),
                                      )
                                      return (
                                        <td key={col.key}>
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

                  {/* Remote Apps Accordions — rows and columns come from the catalog. A feature with
                      no matching `app` record is a deleted/orphaned remote app whose PermissionFeature
                      row is stale in AuthService's catalog (pending a resync) — it must never be
                      assignable, so `!app` has to be EXCLUDED here, not kept. The previous condition
                      (`!app || app.status !== 'Disabled'`) had this backwards: it kept every deleted
                      app's permissions while only correctly hiding ones still registered but Disabled. */}
                  {appGroups
                    .filter(({ app }) => app && app.status !== 'Disabled')
                    .filter(
                      ({ feature }) =>
                        !permSearch ||
                        feature.displayName.toLowerCase().includes(permSearch.toLowerCase()) ||
                        feature.key.toLowerCase().includes(permSearch.toLowerCase()),
                    )
                    .map(({ feature, rows, columns, app }) => {
                      const isExpanded = Boolean(expandedApps[feature.key])
                      const appPerms = getAppPermissions(feature.key)
                      const AppIcon = resolveIcon(app?.iconKey)

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
                                <span className={styles.accordionAppKey}>{feature.key}</span>
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
                              {app && (
                                <span className={styles.activeBadgeSmall}>
                                  <span className={styles.badgeDotGreen} />
                                  {app.status}
                                </span>
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
                                      <th>SUB-MODULE / CAPABILITY</th>
                                      {columns.map((col) => (
                                        <th key={col.key} title={col.displayName}>
                                          {col.displayName.toUpperCase()}
                                        </th>
                                      ))}
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {rows.map((row) => (
                                      <tr key={row.key}>
                                        <td>
                                          <span className={styles.featureName}>{row.label}</span>
                                        </td>
                                        {columns.map((col) => {
                                          const declaredCap = row.capabilities.find(
                                            (c) => c.key.toLowerCase() === col.key.toLowerCase(),
                                          )
                                          return (
                                            <td key={col.key}>
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
                      {(name || email).charAt(0).toUpperCase()}
                    </div>
                    <div className={styles.reviewProfileDetails}>
                      <h4 className={styles.reviewProfileName}>{name}</h4>
                      <span className={styles.reviewProfileEmail}>{email}</span>
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
                      <span className={styles.reviewMetaVal}>{fullPhoneNumber || 'None provided'}</span>
                    </div>
                    <div className={styles.reviewMetaItem}>
                      <span className={styles.reviewMetaLabel}>Administrator Privileges</span>
                      <span className={styles.reviewMetaVal}>
                        {selectedRole?.isAdministrator ? 'Yes (Full Platform Admin)' : 'Standard User'}
                      </span>
                    </div>
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
                                <span className={styles.overrideKey}>{o.featureKey}</span>
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
                                <span className={styles.overrideKey}>{o.featureKey}</span>
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
                <button type="button" className={styles.cancelBtn} onClick={popLayer}>
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
