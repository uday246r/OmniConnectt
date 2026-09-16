import { useEffect, useMemo, useState } from 'react'
import type { CustomPreset, FieldDefinition, ValidationRule } from '@omniconnect/ui/validation'
import { ValidationRulesEditor, describeRuleProblem } from '@omniconnect/ui/validation-editor'
import { Button, Modal } from '@omniconnect/ui'
import { Icon } from '../../../shared/components/Icon/Icon'
import styles from './FieldEditorModal.module.css'

interface FieldEditorModalProps {
  open: boolean
  /** null = adding a new (always custom, never core) field. */
  field: FieldDefinition | null
  existingKeys: string[]
  /** Admin-defined formats from Settings > Manage Formats — offered in the rule picker alongside the
   * built-in catalog. */
  customPresets: CustomPreset[]
  onSave: (field: FieldDefinition) => void
  onClose: () => void
}

function slugify(label: string): string {
  const words = label.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ''
  const [first, ...rest] = words
  const clean = (w: string) => w.replace(/[^a-zA-Z0-9]/g, '')
  return (
    clean(first).toLowerCase() +
    rest.map((w) => { const c = clean(w); return c.charAt(0).toUpperCase() + c.slice(1).toLowerCase() }).join('')
  )
}

/**
 * Adds or edits one user field. The format rules are edited by the shared ValidationRulesEditor — the
 * same editor Lead Management's Field Settings uses — so both screens offer the same formats, wording
 * and live tester.
 */
export function FieldEditorModal({ open, field, existingKeys, customPresets, onSave, onClose }: FieldEditorModalProps) {
  const isEdit = field !== null
  const isCore = field?.core ?? false

  const [label, setLabel] = useState('')
  const [required, setRequired] = useState(true)
  const [rules, setRules] = useState<ValidationRule[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setLabel(field?.label ?? '')
    setRequired(field?.required ?? true)
    setRules(field?.validations ?? [])
    setError(null)
  }, [open, field])

  const key = useMemo(() => field?.key ?? slugify(label), [field, label])

  function handleSave() {
    if (!label.trim()) {
      setError('Label is required.')
      return
    }
    if (!isEdit) {
      if (!key) {
        setError('Enter a label made of letters — an internal key could not be derived from it.')
        return
      }
      if (existingKeys.includes(key)) {
        setError('A field with this internal key already exists — try a slightly different label.')
        return
      }
    }
    const ruleProblem = describeRuleProblem(rules)
    if (ruleProblem) {
      setError(ruleProblem)
      return
    }

    onSave({
      key,
      label: label.trim(),
      core: isCore,
      dataType: field?.dataType ?? 'text',
      required,
      order: field?.order ?? 0,
      validations: rules,
    })
  }

  return (
    <Modal
      open={open}
      title={isEdit ? `Edit "${field?.label}"` : 'Add Field'}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave}>{isEdit ? 'Save Field' : 'Add Field'}</Button>
        </>
      }
    >
      <div className={styles.form}>
        {error && <div className={styles.errorBanner} role="alert">{error}</div>}

        <div className={styles.formGroup}>
          <label className={styles.label}>Label</label>
          <input
            type="text"
            className={styles.input}
            placeholder="e.g. Aadhar Number"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            autoFocus
          />
          {!isCore && (
            <span className={styles.hint}>Internal ID: {key || <em>(type a label above)</em>}</span>
          )}
          {isCore && (
            <span className={styles.hint}>
              <Icon.Lock width={11} height={11} /> Core field — used to sign in / contact this user, so it can't be removed.
            </span>
          )}
        </div>

        <div className={styles.formGroupRow}>
          <div>
            <span className={styles.label}>Required</span>
            <span className={styles.hintInline}>
              {isCore ? 'Core fields are always required.' : 'Must be filled in when creating or editing a user.'}
            </span>
          </div>
          <label className={styles.toggle}>
            <input
              type="checkbox"
              checked={isCore ? true : required}
              disabled={isCore}
              onChange={(e) => setRequired(e.target.checked)}
            />
            <span className={styles.toggleTrack}><span className={styles.toggleThumb} /></span>
          </label>
        </div>

        <div className={styles.rulesSection}>
          <ValidationRulesEditor title="Validation Rules" rules={rules} onChange={setRules} customPresets={customPresets} />
        </div>
      </div>
    </Modal>
  )
}
