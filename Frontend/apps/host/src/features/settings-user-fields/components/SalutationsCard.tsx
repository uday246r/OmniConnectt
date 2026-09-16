import { useCallback, useEffect, useState } from 'react'
import { useAuthStore } from '../../auth/store/authStore'
import { salutationsApi, type SalutationCatalogDto } from '../api/salutationsApi'
import { Icon } from '../../../shared/components/Icon/Icon'
import { ApiError } from '../../../shared/api/httpClient'
import { toast } from '../../../shared/stores/toastStore'
import { Button, Modal } from '@omniremit/ui'
import styles from './SalutationsCard.module.css'

interface SalutationsCardProps {
  canEdit: boolean
}

/** A salutation as the editor holds it: its saved text alongside any edit, so a rename can be described. */
interface DraftEntry {
  id: string
  value: string
  /** The text as saved; empty for an entry added in this session. */
  saved: string
  userCount: number
}

const MAX_LENGTH = 20

let draftCounter = 0

function toDrafts(catalog: SalutationCatalogDto): DraftEntry[] {
  const entries = catalog.entries ?? catalog.salutations.map((value) => ({ id: '', value, userCount: 0 }))
  return entries.map((e) => ({ id: e.id || `new-${++draftCounter}`, value: e.value, saved: e.value, userCount: e.userCount }))
}

/**
 * The one place an admin manages the salutation list (Mr., Ms., ...) offered on Create/Edit User and
 * shown on a profile — see SalutationCatalog's doc comment on the backend.
 *
 * Salutations can be renamed. Correcting "Mr" to "Mr." used to mean removing one and adding the other,
 * which left every user with "Mr" holding a title that no longer existed. An edit now keeps the entry's
 * id, and on save the server changes every profile that shows it; the confirmation says how many first.
 */
export function SalutationsCard({ canEdit }: SalutationsCardProps) {
  const accessToken = useAuthStore((s) => s.accessToken)

  const [entries, setEntries] = useState<DraftEntry[]>([])
  const [version, setVersion] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [newValue, setNewValue] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [confirming, setConfirming] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    if (!accessToken) return
    setLoading(true)
    try {
      const res = await salutationsApi.get(accessToken)
      setEntries(toDrafts(res))
      setVersion(res.version)
      setDirty(false)
      setConflict(false)
      setError(null)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load salutations.')
    } finally {
      setLoading(false)
    }
  }, [accessToken])

  useEffect(() => {
    void load()
  }, [load])

  function isDuplicate(text: string, exceptId?: string) {
    return entries.some((e) => e.id !== exceptId && e.value.toLowerCase() === text.toLowerCase())
  }

  function addSalutation() {
    const trimmed = newValue.trim()
    if (!trimmed) return
    if (trimmed.length > MAX_LENGTH) {
      setError(`A salutation cannot be longer than ${MAX_LENGTH} characters.`)
      return
    }
    if (isDuplicate(trimmed)) {
      setError(`"${trimmed}" is already in the list.`)
      return
    }
    setEntries((prev) => [...prev, { id: `new-${++draftCounter}`, value: trimmed, saved: '', userCount: 0 }])
    setNewValue('')
    setError(null)
    setDirty(true)
  }

  function removeSalutation(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id))
    setDirty(true)
  }

  function commitEdit() {
    if (!editing) return
    const trimmed = editing.text.trim()
    const entry = entries.find((e) => e.id === editing.id)
    if (!entry) return setEditing(null)
    if (!trimmed) return setError('A salutation cannot be empty. Remove it instead.')
    if (trimmed.length > MAX_LENGTH) return setError(`A salutation cannot be longer than ${MAX_LENGTH} characters.`)
    if (isDuplicate(trimmed, editing.id)) return setError(`"${trimmed}" is already in the list.`)

    if (trimmed !== entry.value) {
      setEntries((prev) => prev.map((e) => (e.id === editing.id ? { ...e, value: trimmed } : e)))
      setDirty(true)
    }
    setEditing(null)
    setError(null)
  }

  const renames = entries.filter((e) => e.saved && e.saved !== e.value)
  const affectedUsers = renames.reduce((sum, e) => sum + e.userCount, 0)

  function requestSave() {
    // A rename that changes people's profiles is confirmed first; anything else saves straight away.
    if (affectedUsers > 0) setConfirming(true)
    else void save()
  }

  async function save() {
    if (!accessToken) return
    setConfirming(false)
    setSaving(true)
    try {
      const res = await salutationsApi.update(accessToken, {
        entries: entries.map((e) => ({ id: e.id.startsWith('new-') ? '' : e.id, value: e.value })),
        expectedVersion: version,
      })
      setEntries(toDrafts(res))
      setVersion(res.version)
      setDirty(false)
      toast.success(
        affectedUsers > 0
          ? `Salutations updated. ${affectedUsers} user profile${affectedUsers === 1 ? '' : 's'} now show${affectedUsers === 1 ? 's' : ''} the new title.`
          : 'Salutations updated. They now appear on Create/Edit User and on profiles.',
      )
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflict(true)
        setError(err.message)
      } else {
        toast.error(err instanceof ApiError ? err.message : 'Could not save the salutation list.')
      }
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
            profile. Renaming one changes it on every profile that shows it.
          </p>
        </div>
        {canEdit && (
          <Button variant="primary" size="sm" loading={saving} disabled={!dirty || editing !== null} onClick={requestSave}>
            Save Changes
          </Button>
        )}
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          {error}
          {conflict && (
            <Button variant="secondary" size="sm" onClick={() => void load()} className={styles.reload}>
              Reload
            </Button>
          )}
        </div>
      )}

      {loading ? (
        <span className={styles.hint}>Loading…</span>
      ) : (
        <div className={styles.chipRow}>
          {entries.map((e) =>
            editing?.id === e.id ? (
              <span key={e.id} className={styles.chipEditing}>
                <input
                  className={styles.chipInput}
                  aria-label={`New text for ${e.value}`}
                  value={editing.text}
                  maxLength={MAX_LENGTH}
                  autoFocus
                  onChange={(ev) => setEditing({ id: e.id, text: ev.target.value })}
                  onKeyDown={(ev) => {
                    if (ev.key === 'Enter') { ev.preventDefault(); commitEdit() }
                    if (ev.key === 'Escape') { ev.preventDefault(); setEditing(null); setError(null) }
                  }}
                />
                <button type="button" className={styles.chipAction} onClick={commitEdit} aria-label={`Keep new text for ${e.value}`}>
                  <Icon.Check width={12} height={12} />
                </button>
                <button type="button" className={styles.chipAction} onClick={() => { setEditing(null); setError(null) }} aria-label="Cancel editing">
                  <Icon.X width={11} height={11} />
                </button>
              </span>
            ) : (
              <span key={e.id} className={styles.chip}>
                {e.value}
                {e.saved && e.saved !== e.value && <span className={styles.renamedFrom}>was {e.saved}</span>}
                {e.userCount > 0 && (
                  <span className={styles.count} title={`${e.userCount} user profile${e.userCount === 1 ? '' : 's'}`}>
                    {e.userCount}
                  </span>
                )}
                {canEdit && (
                  <>
                    <button type="button" className={styles.chipAction} onClick={() => setEditing({ id: e.id, text: e.value })} aria-label={`Edit ${e.value}`}>
                      <Icon.Edit width={11} height={11} />
                    </button>
                    <button type="button" className={styles.chipAction} onClick={() => removeSalutation(e.id)} aria-label={`Remove ${e.value}`}>
                      <Icon.X width={11} height={11} />
                    </button>
                  </>
                )}
              </span>
            ),
          )}
          {entries.length === 0 && <span className={styles.hint}>No salutations configured.</span>}
        </div>
      )}

      {canEdit && (
        <div className={styles.addRow}>
          <input
            type="text"
            className={styles.input}
            placeholder="e.g. Prof."
            value={newValue}
            maxLength={MAX_LENGTH}
            onChange={(e) => { setNewValue(e.target.value); setError(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSalutation() } }}
          />
          <Button variant="secondary" size="sm" onClick={addSalutation}>
            <Icon.Plus width={14} height={14} />
            Add
          </Button>
        </div>
      )}

      <Modal
        open={confirming}
        title="Rename salutations?"
        onClose={() => setConfirming(false)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>Rename</Button>
          </>
        }
      >
        <ul className={styles.renameList}>
          {renames.map((e) => (
            <li key={e.id}>
              <strong>{e.saved}</strong> becomes <strong>{e.value}</strong> on{' '}
              {e.userCount === 1 ? '1 user profile' : `${e.userCount} user profiles`}.
            </li>
          ))}
        </ul>
        <p className={styles.hint}>Requests waiting for approval that set the old title will set the new one instead. This is recorded in the audit log.</p>
      </Modal>
    </div>
  )
}
