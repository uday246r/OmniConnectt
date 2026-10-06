import { useCallback, useEffect, useState } from 'react'
import { useAuthStore } from '../../auth/store/authStore'
import { salutationsApi, type SalutationCatalogDto } from '../api/salutationsApi'
import { Icon } from '../../../shared/components/Icon/Icon'
import { ApiError } from '../../../shared/api/httpClient'
import { toast } from '../../../shared/stores/toastStore'
import { Button, Modal } from '@omniconnect/ui'
import styles from './SalutationsCard.module.css'

interface SalutationsCardProps {
  canEdit: boolean
  onCountChange?: (count: number) => void
}

interface DraftEntry {
  id: string
  value: string
  saved: string
  userCount: number
}

const MAX_LENGTH = 20
let draftCounter = 0

function toDrafts(catalog: SalutationCatalogDto): DraftEntry[] {
  const entries = catalog.entries ?? catalog.salutations.map((value) => ({ id: '', value, userCount: 0 }))
  return entries.map((e) => ({ id: e.id || `new-${++draftCounter}`, value: e.value, saved: e.value, userCount: e.userCount }))
}

export function SalutationsCard({ canEdit, onCountChange }: SalutationsCardProps) {
  const accessToken = useAuthStore((s) => s.accessToken)
  const hasAccessToken = Boolean(accessToken)
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
      const drafts = toDrafts(res)
      setEntries(drafts)
      setVersion(res.version)
      setDirty(false)
      setConflict(false)
      setError(null)
      onCountChange?.(drafts.length)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load salutations.')
    } finally {
      setLoading(false)
    }
  }, [hasAccessToken, onCountChange])

  useEffect(() => { void load() }, [load])

  useEffect(() => {
    onCountChange?.(entries.length)
  }, [entries.length, onCountChange])

  function isDuplicate(text: string, exceptId?: string) {
    return entries.some((e) => e.id !== exceptId && e.value.toLowerCase() === text.toLowerCase())
  }

  function addSalutation() {
    const trimmed = newValue.trim()
    if (!trimmed) {
      setError('Please enter a salutation (e.g. Prof., Dr., etc.) before adding.')
      return
    }
    if (trimmed.length > MAX_LENGTH) { setError(`Max ${MAX_LENGTH} characters.`); return }
    if (isDuplicate(trimmed)) { setError(`"${trimmed}" is already in the list.`); return }
    setEntries((prev) => [...prev, { id: `new-${++draftCounter}`, value: trimmed, saved: '', userCount: 0 }])
    setNewValue('')
    setError(null)
    setDirty(true)
    toast.info(`"${trimmed}" added to list. Click "Save Changes" to apply.`)
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
    if (trimmed.length > MAX_LENGTH) return setError(`Max ${MAX_LENGTH} characters.`)
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
          : 'Salutations updated.',
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
      {/* Header */}
      <div className={styles.cardHead}>
        <div className={styles.headLeft}>
          <span className={styles.headIcon}>
            <Icon.Users width={15} height={15} />
          </span>
          <h3 className={styles.headTitle}>
            Salutations
            <span className={styles.headCount}>{entries.length}</span>
          </h3>
        </div>
        {canEdit && (
          <Button variant="primary" size="sm" loading={saving} disabled={!dirty || editing !== null} onClick={requestSave}>
            Save Changes
          </Button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className={styles.errorBanner} role="alert">
          <span>{error}</span>
          {conflict && (
            <Button variant="secondary" size="sm" onClick={() => void load()}>Reload</Button>
          )}
        </div>
      )}

      {/* Add Row */}
      {canEdit && (
        <div className={styles.addRow}>
          <input
            id="salutation-new-input"
            type="text"
            className={styles.addInput}
            placeholder="e.g. Prof."
            value={newValue}
            maxLength={MAX_LENGTH}
            onChange={(e) => { setNewValue(e.target.value); setError(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSalutation() } }}
          />
          <button
            type="button"
            className={styles.addRowBtn}
            onClick={addSalutation}
            aria-label="Add"
          >
            <Icon.Plus width={14} height={14} />
            <span>Add Salutation</span>
          </button>
        </div>
      )}

      {/* List */}
      {loading ? (
        <p className={styles.loadingText}>Loading…</p>
      ) : (
        <div className={styles.list}>
          {entries.map((e) =>
            editing?.id === e.id ? (
              <div key={e.id} className={styles.rowEditing}>
                <input
                  className={styles.rowEditInput}
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
                <button type="button" className={styles.confirmBtn} onClick={commitEdit} aria-label={`Keep new text for ${e.value}`}>
                  <Icon.Check width={13} height={13} />
                </button>
                <button type="button" className={styles.cancelBtn} onClick={() => { setEditing(null); setError(null) }} aria-label="Cancel editing">
                  <Icon.X width={12} height={12} />
                </button>
              </div>
            ) : (
              <div key={e.id} className={styles.row}>
                <div className={styles.rowLeft}>
                  <span className={styles.rowValue}>{e.value}</span>
                  {e.saved && e.saved !== e.value && (
                    <span className={styles.rowRenamed}>was {e.saved}</span>
                  )}
                </div>
                <div className={styles.rowRight}>
                  {e.userCount > 0 && (
                    <span className={styles.rowCount} title={`${e.userCount} user profile${e.userCount === 1 ? '' : 's'}`}>
                      {e.userCount}
                    </span>
                  )}
                  {canEdit && (
                    <>
                      <button
                        type="button"
                        className={styles.rowIconBtn}
                        onClick={() => setEditing({ id: e.id, text: e.value })}
                        aria-label={`Edit ${e.value}`}
                      >
                        <Icon.Edit width={13} height={13} />
                      </button>
                      <button
                        type="button"
                        className={`${styles.rowIconBtn} ${styles.rowIconBtnDanger}`}
                        onClick={() => removeSalutation(e.id)}
                        aria-label={`Remove ${e.value}`}
                      >
                        <Icon.Trash width={13} height={13} />
                      </button>
                    </>
                  )}
                </div>
              </div>
            ),
          )}
          {entries.length === 0 && (
            <p className={styles.emptyMsg}>No salutations configured. Add one above.</p>
          )}
        </div>
      )}

      {/* Unsaved changes banner */}
      {canEdit && dirty && (
        <div className={styles.dirtyNotice}>
          <Icon.AlertCircle width={16} height={16} />
          <span>You have unsaved changes to salutations. Click "Save Changes" in the card header above to apply.</span>
        </div>
      )}

      {/* Rename confirm modal */}
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
        <p className={styles.renameNote}>Requests waiting for approval that set the old title will set the new one instead. Recorded in the audit log.</p>
      </Modal>
    </div>
  )
}
