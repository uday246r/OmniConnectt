import { useEffect, useState } from 'react'
import { useAuthStore } from '../../auth/store/authStore'
import { salutationsApi } from '../api/salutationsApi'
import { Icon } from '../../../shared/components/Icon/Icon'
import { ApiError } from '../../../shared/api/httpClient'
import { toast } from '../../../shared/stores/toastStore'
import { Button } from '@omniremit/ui'
import styles from './SalutationsCard.module.css'

interface SalutationsCardProps {
  canEdit: boolean
}

/**
 * The one place an admin manages the salutation list (Mr., Ms., ...) offered on Create/Edit User and
 * shown on a profile — see SalutationCatalog's doc comment on the backend. Lives at the top of Manage
 * Fields because it's the same "what does the user form collect" concern, just for a fixed dropdown
 * (like Role) rather than an admin-addable field.
 */
export function SalutationsCard({ canEdit }: SalutationsCardProps) {
  const accessToken = useAuthStore((s) => s.accessToken)

  const [salutations, setSalutations] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [newValue, setNewValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false
    salutationsApi
      .get(accessToken)
      .then((res) => {
        if (!cancelled) setSalutations(res.salutations)
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof ApiError ? err.message : 'Could not load salutations.')
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [accessToken])

  function addSalutation() {
    const trimmed = newValue.trim()
    if (!trimmed) return
    if (salutations.some((s) => s.toLowerCase() === trimmed.toLowerCase())) {
      setError(`"${trimmed}" is already in the list.`)
      return
    }
    setSalutations((prev) => [...prev, trimmed])
    setNewValue('')
    setError(null)
    setDirty(true)
  }

  function removeSalutation(value: string) {
    setSalutations((prev) => prev.filter((s) => s !== value))
    setDirty(true)
  }

  async function handleSave() {
    if (!accessToken) return
    setSaving(true)
    try {
      const res = await salutationsApi.update(accessToken, { salutations })
      setSalutations(res.salutations)
      setDirty(false)
      toast.success('Salutations updated. They now appear on Create/Edit User and on profiles.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save the salutation list.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.card}>
      <div className={styles.header}>
        <div>
          <h3 className={styles.title}>Salutations</h3>
          <p className={styles.subtitle}>
            The title options (Mr., Ms., Dr., ...) offered on the Create/Edit User form and shown on a
            profile.
          </p>
        </div>
        {canEdit && (
          <Button variant="primary" size="sm" loading={saving} disabled={!dirty} onClick={handleSave}>
            Save Changes
          </Button>
        )}
      </div>

      {error && <div className={styles.errorBanner} role="alert">{error}</div>}

      {loading ? (
        <span className={styles.hint}>Loading…</span>
      ) : (
        <div className={styles.chipRow}>
          {salutations.map((s) => (
            <span key={s} className={styles.chip}>
              {s}
              {canEdit && (
                <button type="button" className={styles.chipRemove} onClick={() => removeSalutation(s)} aria-label={`Remove ${s}`}>
                  <Icon.X width={11} height={11} />
                </button>
              )}
            </span>
          ))}
          {salutations.length === 0 && <span className={styles.hint}>No salutations configured.</span>}
        </div>
      )}

      {canEdit && (
        <div className={styles.addRow}>
          <input
            type="text"
            className={styles.input}
            placeholder="e.g. Prof."
            value={newValue}
            onChange={(e) => { setNewValue(e.target.value); setError(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSalutation() } }}
          />
          <Button variant="secondary" size="sm" onClick={addSalutation}>
            <Icon.Plus width={14} height={14} />
            Add
          </Button>
        </div>
      )}
    </div>
  )
}
