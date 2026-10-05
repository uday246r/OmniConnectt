import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../../features/auth/store/authStore'
import { remoteAppsApi, type RemoteAppDto } from '../../features/settings-applications/api/remoteAppsApi'
import { isApprovalPending, type ApprovalPendingDto } from '../../features/approvals/api/approvalsApi'
import { useSettingsDrawerStore } from '../../shared/stores/settingsDrawerStore'
import { Icon } from '../../shared/components/Icon/Icon'
import { SkeletonBlock } from '../../shared/components/Skeleton'
import { ApiError } from '../../shared/api/httpClient'
import { toast } from '../../shared/stores/toastStore'
import styles from './ApplicationFormLayer.module.css'
import { TOPICS, invalidate } from '../../shared/stores/invalidationStore'
import { manifestUrl as manifestUrlRule } from '../../shared/validation/rules'

interface ApplicationFormLayerProps {
  appId?: string
}

/**
 * Curated icon choices for a registered application. This is the field's ONLY editor — `iconKey`
 * was already loaded, submitted and rendered everywhere an app appears (sidebar, Checker
 * Assignment, the Role editor's application accordions, via `resolveIcon`), but nothing in this
 * form let an operator actually set or change it, so every newly registered app fell back to the
 * generic Box icon with no way to pick something more identifying.
 */
const APP_ICON_OPTIONS: { key: string; Comp: typeof Icon.Box }[] = [
  { key: 'Box', Comp: Icon.Box },
  { key: 'Layers', Comp: Icon.Layers },
  { key: 'Grid', Comp: Icon.Grid },
  { key: 'Users', Comp: Icon.Users },
  { key: 'Briefcase', Comp: Icon.Briefcase },
  { key: 'Building', Comp: Icon.Building },
  { key: 'Package', Comp: Icon.Package },
  { key: 'Globe', Comp: Icon.Globe },
  { key: 'PieChart', Comp: Icon.PieChart },
  { key: 'Headset', Comp: Icon.Headset },
  { key: 'Shield', Comp: Icon.Shield },
  { key: 'FileText', Comp: Icon.FileText },
]

/** Returns a human-readable field label from an ASP.NET ProblemDetails field name. */
function humanise(field: string): string {
  const map: Record<string, string> = {
    key: 'Application Key',
    manifestUrl: 'Manifest URL',
    permissionsSourceUrl: 'Permissions URL',
    displayName: 'Display Name',
    sidebarOrder: 'Sidebar Sort Order',
  }
  return map[field] ?? field
}

/** Flatten ASP.NET errors dict into readable bullet-list sentences. */
function flattenErrors(errors: Record<string, string[]>): string[] {
  return Object.entries(errors).flatMap(([field, msgs]) =>
    msgs.map((msg) => `${humanise(field)}: ${msg}`),
  )
}

/** Client-side URL check before hitting the server. */
function isValidHttpUrl(value: string): boolean {
  try {
    const u = new URL(value)
    return u.protocol === 'http:' || u.protocol === 'https:'
  } catch {
    return false
  }
}

export function ApplicationFormLayer({ appId }: ApplicationFormLayerProps) {
  const isEdit = Boolean(appId)
  const navigate = useNavigate()
  const accessToken = useAuthStore((s) => s.accessToken)
  // A token refresh must not re-run a load (and reset what the user is editing) — only its first arrival.
  const hasAccessToken = Boolean(accessToken)
  const ensureFreshAccessToken = useAuthStore((s) => s.ensureFreshAccessToken)
  const popLayer = useSettingsDrawerStore((s) => s.popLayer)

  const finish = () => {
    const { returnPath, close } = useSettingsDrawerStore.getState()
    close()
    navigate(returnPath.startsWith('/settings/applications') ? returnPath : '/settings/applications')
  }

  const [loading, setLoading] = useState(isEdit)
  const [saving, setSaving] = useState(false)
  const [pendingApproval, setPendingApproval] = useState<ApprovalPendingDto | null>(null)

  // Generic server error (non-validation)
  const [error, setError] = useState<string | null>(null)
  // Per-field validation errors
  const [fieldErrors, setFieldErrors] = useState<Record<string, string[]>>({})
  // Client-side inline field errors
  const [manifestUrlError, setManifestUrlError] = useState<string | null>(null)
  const [permUrlError, setPermUrlError] = useState<string | null>(null)

  // Fields
  const [key, setKey] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [iconKey, setIconKey] = useState('')
  const [manifestUrl, setManifestUrl] = useState('')
  const [permissionsSourceUrl, setPermissionsSourceUrl] = useState('')
  const [sidebarOrder, setSidebarOrder] = useState<number>(1)
  /** Every other registered app, so the position field can say what each number currently means. */
  const [otherApps, setOtherApps] = useState<RemoteAppDto[]>([])
  /** This app's saved position — the slot a swapped-with app moves into. Null for a new app. */
  const [originalOrder, setOriginalOrder] = useState<number | null>(null)

  useEffect(() => {
    if (!accessToken || !appId) return
    let cancelled = false

    async function load() {
      try {
        const app = await remoteAppsApi.get(accessToken!, appId!)
        if (!cancelled) {
          setKey(app.key)
          setDisplayName(app.displayName)
          setIconKey(app.iconKey ?? '')
          setManifestUrl(app.manifestUrl)
          setPermissionsSourceUrl(app.permissionsSourceUrl ?? '')
          setSidebarOrder(app.sidebarOrder)
          setOriginalOrder(app.sidebarOrder)
        }
      } catch (err: any) {
        if (!cancelled) setError(err?.message || 'Could not load application details.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [hasAccessToken, appId])

  /*
   * The other registered apps, so the position field can say what a number actually means rather
   * than asking an admin to guess. On a NEW app it also supplies the default: the next free slot,
   * instead of a hardcoded number that was usually already taken.
   */
  useEffect(() => {
    if (!accessToken) return
    let cancelled = false

    remoteAppsApi
      .list(accessToken, { pageSize: 100 })
      .then((res) => {
        if (cancelled) return
        const others = res.items.filter((a) => a.id !== appId)
        setOtherApps(others)
        if (!appId) {
          const taken = new Set(others.map((a) => a.sidebarOrder))
          let next = 1
          while (taken.has(next)) next += 1
          setSidebarOrder(next)
        }
      })
      .catch(() => {
        // Non-fatal: the field still works, it just cannot show which positions are taken.
      })

    return () => {
      cancelled = true
    }
  }, [hasAccessToken, appId])

  /** The app currently sitting on the chosen position, if any. */
  const positionOccupant = useMemo(
    () => otherApps.find((a) => a.sidebarOrder === sidebarOrder) ?? null,
    [otherApps, sidebarOrder],
  )

  /** Client-side validation before submit */
  function validate(): boolean {
    let ok = true

    const manifestProblem = manifestUrl ? manifestUrlRule(manifestUrl, key) : undefined
    if (manifestProblem) {
      setManifestUrlError(manifestProblem)
      ok = false
    } else {
      setManifestUrlError(null)
    }

    if (permissionsSourceUrl && !isValidHttpUrl(permissionsSourceUrl)) {
      setPermUrlError('Must be a valid http:// or https:// URL.')
      ok = false
    } else {
      setPermUrlError(null)
    }

    return ok
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    setError(null)
    setFieldErrors({})

    if (!validate()) return

    setSaving(true)

    try {
      const token = await ensureFreshAccessToken()
      if (isEdit && appId) {
        const result = await remoteAppsApi.update(token, appId, {
          displayName,
          iconKey: iconKey || null,
          manifestUrl,
          permissionsSourceUrl: permissionsSourceUrl || null,
          sidebarOrder,
        })

        if (isApprovalPending(result)) {
          // Nothing was actually changed — the "Applications" module has a checker assigned, so this
          // submission is queued instead of applied. There's an existing row to return to, so the
          // drawer just closes rather than showing a dedicated interstitial (mirrors UserFormLayer's
          // own update path).
          toast.success(result.message)
          finish()
          return
        }

        toast.success(`Application '${displayName}' updated successfully.`)
      } else {
        const result = await remoteAppsApi.create(token, {
          key,
          displayName,
          iconKey: iconKey || null,
          manifestUrl,
          permissionsSourceUrl: permissionsSourceUrl || null,
          sidebarOrder,
        })

        if (isApprovalPending(result)) {
          // No app was actually registered — nothing to sync into the sidebar yet.
          toast.success(result.message)
          setPendingApproval(result)
          return
        }

        toast.success(`Application '${displayName}' registered successfully.`)
      }
      // The sidebar is rendered from the navigation tree, so that is what has to be refreshed —
      // otherwise a newly registered app does not appear until the next full page load.
      const { useNavigationStore } = await import('../../shared/stores/navigationStore')
      void useNavigationStore.getState().fetch(token)
      invalidate(TOPICS.applications, TOPICS.approvals, TOPICS.kpis)
      finish()
    } catch (err: any) {
      if (err instanceof ApiError && err.errors) {
        // Show per-field validation errors from ASP.NET ValidationProblemDetails
        setFieldErrors(err.errors)
      } else {
        setError(err?.message || 'Could not save application.')
      }
    } finally {
      setSaving(false)
    }
  }

  // Merge server field errors with client-side field errors for display
  const getFieldError = (serverKey: string): string | null => {
    const serverMsgs = fieldErrors[serverKey] ?? fieldErrors[serverKey.toLowerCase()] ?? []
    return serverMsgs[0] ?? null
  }

  if (pendingApproval) {
    return (
      <div className={styles.layer}>
        <div className={styles.header}>
          <div className={styles.headerTitleWrap}>
            <div className={styles.headerIconBox}>
              <Icon.Grid width={20} height={20} />
            </div>
            <div>
              <h2 className={styles.title}>Register Remote Application</h2>
              <p className={styles.subtitle}>Configure Module Federation 2.0 manifest and runtime discovery</p>
            </div>
          </div>
          <button type="button" className={styles.closeBtn} onClick={popLayer} aria-label="Close">
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
              Registering <strong>{displayName}</strong> requires approval before the application exists.
              {pendingApproval.checkerName && pendingApproval.checkerName !== 'Unassigned'
                ? ` It's been assigned to ${pendingApproval.checkerName}.`
                : ''}{' '}
              Track its status any time from My Requests.
            </p>
            <button
              type="button"
              className={styles.doneBtn}
              onClick={finish}
            >
              Done &amp; Return to Applications List
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
        <div className={`${styles.header} ${styles.afl1}`} >
          <div className={styles.headerTitleWrap}>
            <div className={`${styles.headerIconBox} ${styles.afl2}`} >
              <SkeletonBlock width={22} height={22} radius="6px" />
            </div>
            <div className={styles.afl3}>
              <SkeletonBlock width={170} height={16} radius="5px" />
              <SkeletonBlock width={250} height={12} radius="4px" />
            </div>
          </div>
          <div className={styles.afl4} />
        </div>

        {/* Form body */}
        <div className={styles.afl5}>
          {/* Card 1 */}
          <div className={styles.afl6}>
            <SkeletonBlock width={130} height={13} radius="4px" />
            <div className={styles.afl7}>
              <div className={styles.afl8}>
                {[0, 1].map((i) => (
                  <div key={i} className={styles.afl9}>
                    <SkeletonBlock width="45%" height={11} radius="3px" />
                    <SkeletonBlock width="100%" height={38} radius="9px" />
                  </div>
                ))}
              </div>
              <div className={styles.afl9}>
                <SkeletonBlock width="30%" height={11} radius="3px" />
                <SkeletonBlock width="100%" height={38} radius="9px" />
              </div>
            </div>
          </div>

          {/* Card 2 */}
          <div className={styles.afl6}>
            <SkeletonBlock width={160} height={13} radius="4px" />
            {[0, 1].map((i) => (
              <div key={i} className={styles.afl9}>
                <SkeletonBlock width="40%" height={11} radius="3px" />
                <SkeletonBlock width="100%" height={38} radius="9px" />
              </div>
            ))}
          </div>
        </div>

        {/* Bottom bar */}
        <div className={`${styles.bottomBar} ${styles.afl1}`} >
          <SkeletonBlock width={90} height={36} radius="9px" />
          <SkeletonBlock width={110} height={36} radius="9px" />
        </div>
      </div>
    )
  }

  // Has any server-side validation errors to show as a list?
  const validationErrorList =
    Object.keys(fieldErrors).length > 0 ? flattenErrors(fieldErrors) : null

  return (
    <div className={styles.layer}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerTitleWrap}>
          <div className={styles.headerIconBox}>
            <Icon.Grid width={20} height={20} />
          </div>
          <div>
            <h2 className={styles.title}>{isEdit ? 'Edit Application' : 'Register Remote Application'}</h2>
            <p className={styles.subtitle}>Configure Module Federation 2.0 manifest and runtime discovery</p>
          </div>
        </div>
        <button
          type="button"
          className={styles.closeBtn}
          onClick={finish}
          aria-label="Close"
        >
          <Icon.X width={20} height={20} />
        </button>
      </div>

      {/* Generic server error */}
      {error && (
        <div className={styles.errorAlert} role="alert">
          <span className={styles.afl10}><Icon.AlertCircle width={16} height={16} /></span>
          <span>{error}</span>
        </div>
      )}

      {/* Per-field validation errors as a readable list */}
      {validationErrorList && (
        <div className={styles.validationAlert} role="alert">
          <div className={styles.validationAlertHeader}>
            <Icon.AlertCircle width={15} height={15} />
            <strong>Please fix the following errors:</strong>
          </div>
          <ul className={styles.validationList}>
            {validationErrorList.map((msg, i) => (
              <li key={i}>{msg}</li>
            ))}
          </ul>
        </div>
      )}

      <form id="app-form" onSubmit={(e) => void handleSubmit(e)} className={styles.form}>
        <div className={styles.contentArea}>
          {/* Card 1: Application Identity */}
          <div className={styles.formCard}>
            <h4 className={styles.formCardTitle}>Application Identity</h4>
            <div className={styles.fieldsGrid}>

              <div className={styles.inputGroup}>
                <label className={styles.label}>
                  Application Key <span className={styles.req}>*</span>
                </label>
                <div className={[styles.inputIconWrap, getFieldError('Key') ? styles.inputError : ''].join(' ')}>
                  <input
                    type="text"
                    required
                    disabled={isEdit}
                    className={styles.inputWithIcon}
                    placeholder="e.g. employee"
                    value={key}
                    onChange={(e) => { setKey(e.target.value); setFieldErrors((p) => { const c = {...p}; delete c['Key']; delete c['key']; return c }) }}
                  />
                  <Icon.Grid width={16} height={16} className={styles.fieldLeftIcon} />
                </div>
                {getFieldError('Key') && <span className={styles.fieldError}>{getFieldError('Key')}</span>}
                {!isEdit && <span className={styles.fieldHint}>Used for routing and permission scoping (e.g. remote.{key || '<key>'}).</span>}
              </div>

              <div className={styles.inputGroup}>
                <label className={styles.label}>
                  Display Name <span className={styles.req}>*</span>
                </label>
                <div className={[styles.inputIconWrap, getFieldError('DisplayName') ? styles.inputError : ''].join(' ')}>
                  <input
                    type="text"
                    required
                    className={styles.inputWithIcon}
                    placeholder="e.g. Employee Management"
                    value={displayName}
                    onChange={(e) => { setDisplayName(e.target.value); setFieldErrors((p) => { const c = {...p}; delete c['DisplayName']; delete c['displayName']; return c }) }}
                  />
                  <Icon.Layers width={16} height={16} className={styles.fieldLeftIcon} />
                </div>
                {getFieldError('DisplayName') && <span className={styles.fieldError}>{getFieldError('DisplayName')}</span>}
              </div>

              <div className={styles.inputGroupFull}>
                <label className={styles.label}>App Icon</label>
                <div className={styles.iconPicker} role="radiogroup" aria-label="Application icon">
                  {APP_ICON_OPTIONS.map(({ key, Comp }) => {
                    const isSelected = (iconKey || 'Box') === key
                    return (
                      <button
                        key={key}
                        type="button"
                        role="radio"
                        aria-checked={isSelected}
                        aria-label={`${key} icon`}
                        title={key}
                        className={`${styles.iconSwatch} ${isSelected ? styles.iconSwatchActive : ''}`}
                        onClick={() => setIconKey(key)}
                      >
                        <Comp width={17} height={17} />
                      </button>
                    )
                  })}
                </div>
                <span className={styles.fieldHint}>Shown in the sidebar and wherever this application appears.</span>
              </div>

              <div className={styles.inputGroupFull}>
                <label className={styles.label}>Sidebar Position</label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  className={styles.input}
                  value={sidebarOrder}
                  /* Clamped rather than merely `min`-attributed: the spinner respects min, but typing
                     or pasting "-3" does not, and the old `Number(value) || 0` turned an emptied
                     field into position 0. Position 1 is the top of the Apps list. */
                  onChange={(e) => {
                    const parsed = Math.floor(Number(e.target.value))
                    setSidebarOrder(Number.isFinite(parsed) && parsed >= 1 ? parsed : 1)
                  }}
                />
                {positionOccupant ? (
                  <span className={styles.fieldHint}>
                    {isEdit && originalOrder !== null ? (
                      <>
                        <strong>{positionOccupant.displayName}</strong> is at position {sidebarOrder} — saving swaps
                        the two, so it moves to {originalOrder} and this app takes {sidebarOrder}.
                      </>
                    ) : (
                      <>
                        Position {sidebarOrder} is already used by <strong>{positionOccupant.displayName}</strong>. Both
                        would sit at {sidebarOrder} and be listed by name — pick a free number to avoid that.
                      </>
                    )}
                  </span>
                ) : (
                  <span className={styles.fieldHint}>
                    Position 1 is the top of the Apps list.
                    {otherApps.length > 0 && (
                      <> Currently: {[...otherApps].sort((a, b) => a.sidebarOrder - b.sidebarOrder).map((a) => `${a.sidebarOrder}. ${a.displayName}`).join(', ')}.</>
                    )}
                  </span>
                )}
              </div>

            </div>
          </div>

          {/* Card 2: Integration & Federation Endpoints */}
          <div className={styles.formCard}>
            <h4 className={styles.formCardTitle}>Integration &amp; Federation Endpoints</h4>
            <div className={styles.fieldsGrid}>

              <div className={styles.inputGroupFull}>
                <label className={styles.label}>
                  Module Federation Manifest URL <span className={styles.req}>*</span>
                </label>
                <div className={[styles.inputIconWrap, (manifestUrlError || getFieldError('ManifestUrl')) ? styles.inputError : ''].join(' ')}>
                  <input
                    type="text"
                    required
                    className={styles.inputWithIcon}
                    placeholder={`/modules/${key || '<key>'}/<version>/mf-manifest.json`}
                    value={manifestUrl}
                    onChange={(e) => {
                      setManifestUrl(e.target.value)
                      setManifestUrlError(null)
                      setFieldErrors((p) => { const c = {...p}; delete c['ManifestUrl']; delete c['manifestUrl']; return c })
                    }}
                  />
                  <Icon.Globe width={16} height={16} className={styles.fieldLeftIcon} />
                </div>
                {(manifestUrlError || getFieldError('ManifestUrl')) && (
                  <span className={styles.fieldError}>
                    {manifestUrlError ?? getFieldError('ManifestUrl')}
                  </span>
                )}
              </div>

              <div className={styles.inputGroupFull}>
                <label className={styles.label}>Permissions Discovery URL <span className={styles.optionalTag}>Optional</span></label>
                <div className={[styles.inputIconWrap, (permUrlError || getFieldError('PermissionsSourceUrl')) ? styles.inputError : ''].join(' ')}>
                  <input
                    type="text"
                    className={styles.inputWithIcon}
                    placeholder="https://your-app.com/api/permissions"
                    value={permissionsSourceUrl}
                    onChange={(e) => {
                      setPermissionsSourceUrl(e.target.value)
                      setPermUrlError(null)
                      setFieldErrors((p) => { const c = {...p}; delete c['PermissionsSourceUrl']; delete c['permissionsSourceUrl']; return c })
                    }}
                  />
                  <Icon.Activity width={16} height={16} className={styles.fieldLeftIcon} />
                </div>
                {(permUrlError || getFieldError('PermissionsSourceUrl')) && (
                  <span className={styles.fieldError}>
                    {permUrlError ?? getFieldError('PermissionsSourceUrl')}
                  </span>
                )}
              </div>

            </div>
          </div>
        </div>

        {/* Sticky Bottom Bar */}
        <div className={styles.bottomBar}>
          <button type="button" className={styles.cancelBtn} onClick={finish}>
            Cancel
          </button>
          <button type="submit" className={styles.saveBtn} disabled={saving}>
            {saving ? (
              <span>Saving…</span>
            ) : (
              <>
                <Icon.CheckCircle width={16} height={16} />
                <span>{isEdit ? 'Save Changes' : 'Register Application'}</span>
              </>
            )}
          </button>
        </div>
      </form>
    </div>
  )
}
