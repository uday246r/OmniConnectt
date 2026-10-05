import { useEffect, useMemo, useState } from 'react'
import { Button, Modal, Select } from '@omniconnect/ui'
import type { FieldDefinition } from '@omniconnect/ui/validation'
import { useAuthStore } from '../../auth/store/authStore'
import { fieldSectionsApi, type FieldSection, type FieldSectionCatalogDto } from '../api/fieldSectionsApi'
import { Icon } from '../../../shared/components/Icon/Icon'
import { ApiError } from '../../../shared/api/httpClient'
import { toast } from '../../../shared/stores/toastStore'
import { resolveSectionKey } from '../utils/sections'
import styles from './FieldSectionsCard.module.css'

interface FieldSectionsCardProps {
  canEdit: boolean
  /** The saved catalog, owned by the page — the page needs it too, for grouping and the field editor. */
  sections: FieldSection[]
  version: number | undefined
  /** Every field in the schema, only to count how many each section holds. */
  fields: FieldDefinition[]
  /**
   * True while the Fields tabs have unsaved edits. Deleting a section can move fields server-side, which
   * would silently discard those edits when the page reloads, so saving sections waits until the field
   * changes are saved or discarded.
   */
  fieldsDirty: boolean
  /** Called with the saved catalog so the page can reload its field list (a delete may have moved fields). */
  onSaved: (catalog: FieldSectionCatalogDto) => void
}

interface DraftSection {
  /** Stable React key — a brand-new section has no server key yet, so this is not `key`. */
  id: string
  /** Empty for a section created in this editing session; the server derives it from the label. */
  key: string
  label: string
  isSystem: boolean
}

const MAX_LENGTH = 100
let draftCounter = 0

function toDrafts(sections: FieldSection[]): DraftSection[] {
  return [...sections]
    .sort((a, b) => a.order - b.order)
    .map((s) => ({ id: s.key, key: s.key, label: s.label, isSystem: s.isSystem }))
}

/**
 * The "Sections" tab of Manage Fields: create, rename, reorder and delete the headings that group
 * fields on the user form.
 *
 * Nothing here touches the server until Save. Order is the list's position — the admin never types a
 * number — and Move up / Move down are plain buttons rather than drag handles: keyboard-operable, no
 * pointer-only affordance, and no drag-and-drop dependency in a workspace that has none.
 */
export function FieldSectionsCard({ canEdit, sections, version, fields, fieldsDirty, onSaved }: FieldSectionsCardProps) {
  const accessToken = useAuthStore((s) => s.accessToken)
  const [draft, setDraft] = useState<DraftSection[]>(() => toDrafts(sections))
  const [newLabel, setNewLabel] = useState('')
  const [editing, setEditing] = useState<{ id: string; text: string } | null>(null)
  const [reassign, setReassign] = useState<Record<string, string>>({})
  const [deleting, setDeleting] = useState<DraftSection | null>(null)
  const [deleteTarget, setDeleteTarget] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // A new saved catalog (after Save, or the page's own reload) replaces the draft wholesale.
  useEffect(() => {
    setDraft(toDrafts(sections))
    setReassign({})
    setEditing(null)
    setError(null)
  }, [sections, version])

  const fieldCounts = useMemo(() => {
    const counts = new Map<string, number>()
    for (const f of fields) {
      const k = resolveSectionKey(f.section, sections)
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return counts
  }, [fields, sections])

  const saved = useMemo(() => toDrafts(sections), [sections])
  const dirty =
    draft.length !== saved.length ||
    draft.some((d, i) => d.key !== saved[i].key || d.label !== saved[i].label)

  function labelProblem(label: string, exceptId?: string): string | null {
    const trimmed = label.trim()
    if (!trimmed) return 'A section needs a name.'
    if (trimmed.length > MAX_LENGTH) return `Section names can be at most ${MAX_LENGTH} characters.`
    if (draft.some((d) => d.id !== exceptId && d.label.trim().toLowerCase() === trimmed.toLowerCase())) {
      return `There is already a section named "${trimmed}".`
    }
    return null
  }

  function addSection() {
    const problem = labelProblem(newLabel)
    if (problem) { setError(problem); return }
    setDraft((prev) => [...prev, { id: `new-${++draftCounter}`, key: '', label: newLabel.trim(), isSystem: false }])
    setNewLabel('')
    setError(null)
  }

  function commitRename() {
    if (!editing) return
    const problem = labelProblem(editing.text, editing.id)
    if (problem) { setError(problem); return }
    setDraft((prev) => prev.map((d) => (d.id === editing.id ? { ...d, label: editing.text.trim() } : d)))
    setEditing(null)
    setError(null)
  }

  function move(id: string, delta: -1 | 1) {
    setDraft((prev) => {
      const from = prev.findIndex((d) => d.id === id)
      const to = from + delta
      if (from < 0 || to < 0 || to >= prev.length) return prev
      const next = [...prev]
      ;[next[from], next[to]] = [next[to], next[from]]
      return next
    })
  }

  function requestDelete(section: DraftSection) {
    const count = section.key ? (fieldCounts.get(section.key) ?? 0) : 0
    if (count === 0) {
      removeFromDraft(section)
      return
    }
    // Choose where the fields go BEFORE the section disappears — the server refuses a delete that
    // would strand fields, and a silent dump into another section would rearrange a form unasked.
    const firstOther = draft.find((d) => d.id !== section.id && d.key)
    setDeleteTarget(firstOther?.key ?? '')
    setDeleting(section)
  }

  function removeFromDraft(section: DraftSection, moveTo?: string) {
    setDraft((prev) => prev.filter((d) => d.id !== section.id))
    if (section.key && moveTo) setReassign((prev) => ({ ...prev, [section.key]: moveTo }))
  }

  function confirmDelete() {
    if (!deleting || !deleteTarget) return
    removeFromDraft(deleting, deleteTarget)
    setDeleting(null)
  }

  function discard() {
    setDraft(toDrafts(sections))
    setReassign({})
    setEditing(null)
    setError(null)
  }

  async function save() {
    if (!accessToken) return
    setSaving(true)
    setError(null)
    try {
      const survivingKeys = new Set(draft.map((d) => d.key).filter(Boolean))
      // Only reassignments for sections that are actually gone, and only to sections that survive.
      const relevant = Object.fromEntries(
        Object.entries(reassign).filter(([removed, target]) => !survivingKeys.has(removed) && survivingKeys.has(target)),
      )
      const res = await fieldSectionsApi.update(accessToken, {
        sections: draft.map((d, i) => ({ key: d.key, label: d.label.trim(), order: i + 1, isSystem: d.isSystem })),
        expectedVersion: version,
        reassignFieldsTo: Object.keys(relevant).length > 0 ? relevant : undefined,
      })
      onSaved(res)
      toast.success('Sections updated. The user form now reflects them.')
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Could not save the sections.'
      setError(message)
      if (!(err instanceof ApiError && err.status === 409)) toast.error(message)
    } finally {
      setSaving(false)
    }
  }

  const deleteTargets = draft
    .filter((d) => d.id !== deleting?.id && d.key)
    .map((d) => ({ value: d.key, label: d.label }))

  return (
    <div className={styles.card}>
      <div className={styles.cardHead}>
        <div className={styles.headLeft}>
          <span className={styles.headIcon}>
            <Icon.Layers width={15} height={15} />
          </span>
          <div>
            <h3 className={styles.headTitle}>
              Form Sections
              <span className={styles.headCount}>{draft.length}</span>
            </h3>
            <p className={styles.headDesc}>
              The headings that group fields on the user form. Renaming a section keeps every field in it.
            </p>
          </div>
        </div>
        {canEdit && (
          <div className={styles.headActions}>
            <Button variant="secondary" size="sm" disabled={!dirty || saving} onClick={discard}>
              Discard
            </Button>
            <Button
              variant="primary"
              size="sm"
              loading={saving}
              disabled={!dirty || editing !== null || fieldsDirty}
              onClick={() => void save()}
            >
              Save Sections
            </Button>
          </div>
        )}
      </div>

      {fieldsDirty && canEdit && (
        <div className={styles.notice} role="status">
          <Icon.Info width={14} height={14} />
          <span>Save or discard your unsaved field changes before saving sections.</span>
        </div>
      )}

      {error && (
        <div className={styles.errorBanner} role="alert">
          <span>{error}</span>
        </div>
      )}

      {canEdit && (
        <div className={styles.addRow}>
          <input
            id="section-new-input"
            type="text"
            className={styles.addInput}
            placeholder="e.g. Employment Details"
            aria-label="New section name"
            value={newLabel}
            maxLength={MAX_LENGTH}
            onChange={(e) => { setNewLabel(e.target.value); setError(null) }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addSection() } }}
          />
          <button type="button" className={styles.addBtn} onClick={addSection}>
            <Icon.Plus width={14} height={14} />
            <span>Add Section</span>
          </button>
        </div>
      )}

      <div className={styles.tableHeader}>
        <span>Section</span>
        <span>Fields</span>
        <span className={styles.thAction}>Actions</span>
      </div>

      <ol className={styles.list}>
        {draft.map((section, index) => {
          const count = section.key ? (fieldCounts.get(section.key) ?? 0) : 0
          const isEditing = editing?.id === section.id
          return (
            <li key={section.id} className={styles.row}>
              <div className={styles.rowName}>
                <span className={styles.position} aria-hidden="true">{index + 1}</span>
                {isEditing ? (
                  <input
                    className={styles.editInput}
                    aria-label={`New name for ${section.label}`}
                    value={editing.text}
                    maxLength={MAX_LENGTH}
                    autoFocus
                    onChange={(e) => setEditing({ id: section.id, text: e.target.value })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); commitRename() }
                      if (e.key === 'Escape') { e.preventDefault(); setEditing(null); setError(null) }
                    }}
                  />
                ) : (
                  <span className={styles.rowLabel}>
                    {section.label}
                    {section.isSystem && <span className={styles.systemTag}>Default</span>}
                    {!section.key && <span className={styles.newTag}>New</span>}
                  </span>
                )}
              </div>

              <div>
                <span className={styles.countPill} title={`${count} field${count === 1 ? '' : 's'} in this section`}>
                  {count}
                </span>
              </div>

              <div className={styles.actions}>
                {canEdit && isEditing && (
                  <>
                    <button type="button" className={styles.iconBtn} onClick={commitRename} aria-label={`Keep new name for ${section.label}`}>
                      <Icon.Check width={13} height={13} />
                    </button>
                    <button type="button" className={styles.iconBtn} onClick={() => { setEditing(null); setError(null) }} aria-label="Cancel renaming">
                      <Icon.X width={12} height={12} />
                    </button>
                  </>
                )}
                {canEdit && !isEditing && (
                  <>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => move(section.id, -1)}
                      disabled={index === 0}
                      aria-label={`Move ${section.label} up`}
                      title="Move up"
                    >
                      <Icon.ChevronUp width={14} height={14} />
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => move(section.id, 1)}
                      disabled={index === draft.length - 1}
                      aria-label={`Move ${section.label} down`}
                      title="Move down"
                    >
                      <Icon.ChevronDown width={14} height={14} />
                    </button>
                    <button
                      type="button"
                      className={styles.iconBtn}
                      onClick={() => setEditing({ id: section.id, text: section.label })}
                      aria-label={`Rename ${section.label}`}
                      title="Rename"
                    >
                      <Icon.Edit width={13} height={13} />
                    </button>
                    {!section.isSystem && (
                      <button
                        type="button"
                        className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                        onClick={() => requestDelete(section)}
                        aria-label={`Delete ${section.label}`}
                        title="Delete"
                      >
                        <Icon.Trash width={13} height={13} />
                      </button>
                    )}
                  </>
                )}
              </div>
            </li>
          )
        })}
      </ol>

      <Modal
        open={deleting !== null}
        title={`Delete "${deleting?.label ?? ''}"?`}
        onClose={() => setDeleting(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDeleting(null)}>Cancel</Button>
            <Button variant="primary" disabled={!deleteTarget} onClick={confirmDelete}>Delete section</Button>
          </>
        }
      >
        {deleting && (
          <div className={styles.deleteBody}>
            <p>
              This section has {fieldCounts.get(deleting.key) ?? 0} field(s). They are not deleted — choose the
              section they move to. Nothing changes until you save.
            </p>
            <label className={styles.deleteLabel} htmlFor="section-delete-target">Move its fields to</label>
            <Select
              id="section-delete-target"
              value={deleteTarget}
              onChange={(e) => setDeleteTarget(e.target.value)}
              options={deleteTargets}
            />
          </div>
        )}
      </Modal>
    </div>
  )
}
