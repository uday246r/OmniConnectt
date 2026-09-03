import { useState } from 'react'
import { Button, Select } from '@omniremit/ui'
import { useAuthStore } from '../../features/auth/store/authStore'
import {
  entitlementsApi,
  type EntitlementNodeDto,
  type EntitlementStatus,
  type EntitlementVisibility,
} from '../../features/settings-licensing/api/entitlementsApi'
import { SkeletonBlock } from '../../shared/components/Skeleton'
import { Icon } from '../../shared/components/Icon/Icon'
import { ApiError, isAbortError } from '../../shared/api/httpClient'
import { toast } from '../../shared/stores/toastStore'
import { useNavigationStore } from '../../shared/stores/navigationStore'
import { useAbortableEffect } from '../../shared/hooks/useAbortableEffect'
import styles from './SettingsLicensingTab.module.css'

/**
 * What this deployment has bought, feature by feature.
 *
 * Deliberately separate from the Roles editor, because the two answer different questions. A role
 * says who may use something; this says whether it was purchased at all. Conflating them would mean
 * revoking a licence by editing every role that referenced it, and would leave no way to author a
 * role against a module the customer has not bought yet.
 *
 * Changing a row here takes effect on this node immediately and across the other services within
 * their 30-second refresh — bounded and predictable, which is the trade made to keep licensing off
 * the database on every request.
 */

const STATUS_OPTIONS = [
  { value: 'Licensed', label: 'Licensed' },
  { value: 'Unlicensed', label: 'Unlicensed' },
  { value: 'Trial', label: 'Trial' },
]

const VISIBILITY_OPTIONS = [
  { value: 'Normal', label: 'Normal' },
  { value: 'Locked', label: 'Always locked' },
  { value: 'Hidden', label: 'Hidden' },
]

function OutcomeBadge({ node }: { node: EntitlementNodeDto }) {
  const cls =
    node.effectiveOutcome === 'Available'
      ? styles.outcomeAvailable
      : node.effectiveOutcome === 'Locked'
        ? styles.outcomeLocked
        : styles.outcomeHidden

  return <span className={`${styles.outcome} ${cls}`}>{node.effectiveOutcome}</span>
}

function Row({
  node,
  depth,
  saving,
  onChange,
}: {
  node: EntitlementNodeDto
  depth: number
  saving: string | null
  onChange: (featureKey: string, patch: Partial<EntitlementNodeDto>) => void
}) {
  const isSaving = saving === node.featureKey

  return (
    <>
      <tr className={node.isActive ? undefined : styles.rowInactive}>
        <td className={styles.cell}>
          <div className={styles.name} style={{ paddingLeft: `${depth * 18}px` }}>
            <span className={styles.displayName}>{node.displayName}</span>
            <code className={styles.key}>{node.featureKey}</code>
            {/* An inherited row has no entitlement of its own — it follows whatever its module says. */}
            {!node.hasOwnEntitlement && <span className={styles.inherited}>inherited</span>}
          </div>
        </td>

        <td className={styles.cell}>
          <Select
            size="sm"
            value={node.status}
            options={STATUS_OPTIONS}
            disabled={isSaving}
            onChange={(e) => onChange(node.featureKey, { status: e.target.value as EntitlementStatus })}
          />
        </td>

        <td className={styles.cell}>
          <Select
            size="sm"
            value={node.visibility}
            options={VISIBILITY_OPTIONS}
            disabled={isSaving}
            onChange={(e) => onChange(node.featureKey, { visibility: e.target.value as EntitlementVisibility })}
          />
        </td>

        <td className={styles.cell}>
          <input
            className={styles.input}
            value={node.planTier ?? ''}
            placeholder="Included"
            disabled={isSaving}
            onChange={(e) => onChange(node.featureKey, { planTier: e.target.value })}
          />
        </td>

        <td className={styles.cell}>
          <input
            className={styles.input}
            value={node.lockReason ?? ''}
            placeholder="Shown to the user on the locked screen"
            disabled={isSaving}
            onChange={(e) => onChange(node.featureKey, { lockReason: e.target.value })}
          />
        </td>

        <td className={styles.cell}>
          <OutcomeBadge node={node} />
        </td>
      </tr>

      {node.children.map((child) => (
        <Row key={child.featureKey} node={child} depth={depth + 1} saving={saving} onChange={onChange} />
      ))}
    </>
  )
}

export function SettingsLicensingTab() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const isAdministrator = useAuthStore((s) => Boolean(s.user?.isAdministrator))
  const hasCapability = useAuthStore((s) => s.hasCapability)
  const canManage = isAdministrator || hasCapability('host.settings.licensing', 'Manage')

  const [tree, setTree] = useState<EntitlementNodeDto[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState<string | null>(null)
  const [dirty, setDirty] = useState<Record<string, EntitlementNodeDto>>({})

  const fetchNavigation = useNavigationStore((s) => s.fetch)

  useAbortableEffect(
    async (signal) => {
      if (!accessToken) return
      try {
        setTree(await entitlementsApi.list(accessToken, signal))
        setError(null)
      } catch (err) {
        if (isAbortError(err)) return
        setError(err instanceof ApiError ? err.message : 'Could not load licensing.')
      }
    },
    [accessToken],
  )

  // Edits are held locally until Save, so changing a plan label does not fire a request per keystroke.
  function stage(featureKey: string, patch: Partial<EntitlementNodeDto>) {
    setTree((prev) => {
      if (!prev) return prev
      const apply = (nodes: EntitlementNodeDto[]): EntitlementNodeDto[] =>
        nodes.map((n) =>
          n.featureKey === featureKey
            ? { ...n, ...patch }
            : { ...n, children: apply(n.children) },
        )
      const next = apply(prev)
      const found = (function find(nodes: EntitlementNodeDto[]): EntitlementNodeDto | undefined {
        for (const n of nodes) {
          if (n.featureKey === featureKey) return n
          const hit = find(n.children)
          if (hit) return hit
        }
      })(next)
      if (found) setDirty((d) => ({ ...d, [featureKey]: found }))
      return next
    })
  }

  async function save(featureKey: string) {
    const node = dirty[featureKey]
    if (!node || !accessToken) return

    setSaving(featureKey)
    try {
      await entitlementsApi.update(accessToken, featureKey, {
        status: node.status,
        visibility: node.visibility,
        planTier: node.planTier || null,
        lockReason: node.lockReason || null,
        expiresAt: node.expiresAt,
      })
      setTree(await entitlementsApi.list(accessToken))
      setDirty((d) => {
        const { [featureKey]: _removed, ...rest } = d
        return rest
      })
      // The sidebar is built from the same entitlements, so it has to be refetched or the row the
      // admin just locked keeps rendering as available until something else happens to reload it.
      await fetchNavigation(accessToken)
      toast.success('Licensing updated.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not update licensing.')
    } finally {
      setSaving(null)
    }
  }

  if (error) {
    return <div className={styles.error} role="status">{error}</div>
  }

  if (!tree) {
    return (
      <div className={styles.loading}>
        {Array.from({ length: 6 }, (_, i) => (
          <SkeletonBlock key={i} height={40} />
        ))}
      </div>
    )
  }

  const pending = Object.keys(dirty)

  return (
    <div className={styles.wrap}>
      <div className={styles.intro}>
        <Icon.Key width={16} height={16} />
        <p>
          What this deployment is licensed for. This is separate from roles: a role decides who may use
          a module, this decides whether it was bought at all. Both must pass, and the API enforces
          this independently of what the sidebar shows.
        </p>
      </div>

      {!canManage && (
        <div className={styles.readOnly} role="status">
          You can view licensing but not change it. Managing licences requires the Manage capability.
        </div>
      )}

      <div className={styles.tableWrap}>
        <table className={styles.table}>
          <thead>
            <tr>
              <th>Feature</th>
              <th>Status</th>
              <th>Visibility</th>
              <th>Plan</th>
              <th>Lock reason</th>
              <th>Effective</th>
            </tr>
          </thead>
          <tbody>
            {tree.map((node) => (
              <Row
                key={node.featureKey}
                node={node}
                depth={0}
                saving={saving}
                onChange={canManage ? stage : () => {}}
              />
            ))}
          </tbody>
        </table>
      </div>

      {canManage && pending.length > 0 && (
        <div className={styles.footer}>
          <span className={styles.pendingCount}>
            {pending.length} unsaved change{pending.length === 1 ? '' : 's'}
          </span>
          {pending.map((key) => (
            <Button key={key} size="sm" onClick={() => void save(key)} loading={saving === key}>
              Save {key}
            </Button>
          ))}
        </div>
      )}
    </div>
  )
}
