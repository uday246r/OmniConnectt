import { useEffect, useMemo, useState } from 'react'
import {
  CUSTOM_PRESET_ID,
  FIELD_PRESETS,
  PRESET_GROUP_LABELS,
  findPreset,
  testRule,
  type CustomPreset,
  type FieldDefinition,
  type ValidationRule,
} from '@omniremit/ui/validation'
import { Button, Modal } from '@omniremit/ui'
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

let ruleIdCounter = 0
function nextRuleId() {
  ruleIdCounter += 1
  return `rule-${ruleIdCounter}`
}

export function FieldEditorModal({ open, field, existingKeys, customPresets, onSave, onClose }: FieldEditorModalProps) {
  const isEdit = field !== null
  const isCore = field?.core ?? false

  const [label, setLabel] = useState('')
  const [required, setRequired] = useState(true)
  const [rules, setRules] = useState<(ValidationRule & { _id: string })[]>([])
  const [addRuleChoice, setAddRuleChoice] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [testValues, setTestValues] = useState<Record<string, string>>({})

  useEffect(() => {
    if (!open) return
    setLabel(field?.label ?? '')
    setRequired(field?.required ?? true)
    setRules((field?.validations ?? []).map((r) => ({ ...r, _id: nextRuleId() })))
    setAddRuleChoice('')
    setError(null)
    setTestValues({})
  }, [open, field])

  const key = useMemo(() => field?.key ?? slugify(label), [field, label])

  const availablePresets = useMemo(
    () => FIELD_PRESETS.filter((p) => !rules.some((r) => r.type === p.id)),
    [rules],
  )

  const availableCustomPresets = useMemo(
    () => customPresets.filter((p) => !rules.some((r) => r.type === p.key)),
    [customPresets, rules],
  )

  function addRule(presetId: string) {
    if (!presetId) return
    if (presetId === CUSTOM_PRESET_ID) {
      setRules((prev) => [...prev, { _id: nextRuleId(), type: CUSTOM_PRESET_ID, pattern: '', message: 'Enter a valid value.' }])
      setAddRuleChoice('')
      return
    }
    const customPreset = customPresets.find((p) => p.key === presetId)
    if (customPreset) {
      setRules((prev) => [...prev, { _id: nextRuleId(), type: customPreset.key, message: customPreset.message }])
      setAddRuleChoice('')
      return
    }
    const preset = findPreset(presetId)
    if (!preset) return
    const rule: ValidationRule & { _id: string } = { _id: nextRuleId(), type: preset.id, message: preset.defaultMessage }
    if (preset.id === 'minLength' || preset.id === 'maxLength' || preset.id === 'exactLength') {
      rule.value = preset.id === 'minLength' ? 2 : preset.id === 'maxLength' ? 50 : 10
    }
    setRules((prev) => [...prev, rule])
    setAddRuleChoice('')
  }

  function updateRule(id: string, patch: Partial<ValidationRule>) {
    setRules((prev) => prev.map((r) => (r._id === id ? { ...r, ...patch } : r)))
  }

  function removeRule(id: string) {
    setRules((prev) => prev.filter((r) => r._id !== id))
    setTestValues((prev) => {
      const next = { ...prev }
      delete next[id]
      return next
    })
  }

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
    for (const rule of rules) {
      if (rule.type === CUSTOM_PRESET_ID) {
        if (!rule.pattern?.trim()) {
          setError('Every custom pattern rule needs a regular expression.')
          return
        }
        try {
          // eslint-disable-next-line no-new
          new RegExp(rule.pattern)
        } catch {
          setError(`"${rule.pattern}" is not valid regular expression syntax.`)
          return
        }
      }
    }

    const cleanRules: ValidationRule[] = rules.map(({ _id, ...r }) => r)
    onSave({
      key,
      label: label.trim(),
      core: isCore,
      dataType: field?.dataType ?? 'text',
      required,
      order: field?.order ?? 0,
      validations: cleanRules,
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
          <div className={styles.rulesSectionHeader}>
            <span className={styles.label}>Validation Rules</span>
            {rules.length === 0 && <span className={styles.hintInline}>No extra rules — any value is accepted.</span>}
          </div>

          {rules.map((rule) => {
            const preset = rule.type === CUSTOM_PRESET_ID ? undefined : findPreset(rule.type)
            const matchingCustomPreset = customPresets.find((p) => p.key === rule.type)
            const testValue = testValues[rule._id] ?? ''
            const testResult = testValue ? testRule(rule, testValue, customPresets) : null
            return (
              <div key={rule._id} className={styles.ruleCard}>
                <div className={styles.ruleCardHeader}>
                  <span className={styles.ruleName}>
                    {rule.type === CUSTOM_PRESET_ID
                      ? 'Custom Pattern (Regex)'
                      : preset?.label ?? matchingCustomPreset?.label ?? rule.type}
                  </span>
                  <button type="button" className={styles.removeRuleBtn} onClick={() => removeRule(rule._id)} aria-label="Remove rule">
                    <Icon.Trash width={14} height={14} />
                  </button>
                </div>

                {rule.type === CUSTOM_PRESET_ID && (
                  <div className={styles.formGroup}>
                    <label className={styles.labelSm}>Regular expression</label>
                    <input
                      type="text"
                      className={styles.inputMono}
                      placeholder="^EMP-[0-9]{4}$"
                      value={rule.pattern ?? ''}
                      onChange={(e) => updateRule(rule._id, { pattern: e.target.value })}
                    />
                  </div>
                )}

                {(rule.type === 'minLength' || rule.type === 'maxLength' || rule.type === 'exactLength') && (
                  <div className={styles.formGroup}>
                    <label className={styles.labelSm}>
                      {rule.type === 'minLength' ? 'Minimum characters' : rule.type === 'maxLength' ? 'Maximum characters' : 'Exact number of characters'}
                    </label>
                    <input
                      type="number"
                      min={1}
                      className={styles.input}
                      value={rule.value ?? ''}
                      onChange={(e) => updateRule(rule._id, { value: Number(e.target.value) || undefined })}
                    />
                  </div>
                )}

                <div className={styles.formGroup}>
                  <label className={styles.labelSm}>Error message shown to the person filling the form</label>
                  <input
                    type="text"
                    className={styles.input}
                    value={rule.message}
                    onChange={(e) => updateRule(rule._id, { message: e.target.value })}
                  />
                </div>

                <div className={styles.testerRow}>
                  <input
                    type="text"
                    className={styles.testerInput}
                    placeholder="Type a sample value to test this rule..."
                    value={testValue}
                    onChange={(e) => setTestValues((prev) => ({ ...prev, [rule._id]: e.target.value }))}
                  />
                  {testResult && (
                    <span className={testResult.ok ? styles.testerPass : styles.testerFail}>
                      {testResult.ok ? <Icon.Check width={13} height={13} /> : <Icon.X width={13} height={13} />}
                      {testResult.ok ? 'Passes' : testResult.message}
                    </span>
                  )}
                </div>
              </div>
            )
          })}

          <div className={styles.addRuleRow}>
            <select
              className={styles.select}
              value={addRuleChoice}
              onChange={(e) => addRule(e.target.value)}
            >
              <option value="">+ Add Validation Rule...</option>
              {(['textShape', 'format', 'length'] as const).map((group) => {
                const options = availablePresets.filter((p) => p.group === group)
                if (options.length === 0) return null
                return (
                  <optgroup key={group} label={PRESET_GROUP_LABELS[group]}>
                    {options.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </optgroup>
                )
              })}
              {availableCustomPresets.length > 0 && (
                <optgroup label="Custom Formats">
                  {availableCustomPresets.map((p) => (
                    <option key={p.key} value={p.key}>{p.label}</option>
                  ))}
                </optgroup>
              )}
              {!rules.some((r) => r.type === CUSTOM_PRESET_ID) && (
                <optgroup label={PRESET_GROUP_LABELS.custom}>
                  <option value={CUSTOM_PRESET_ID}>One-off Custom Pattern (Regex)</option>
                </optgroup>
              )}
            </select>
          </div>
        </div>
      </div>
    </Modal>
  )
}
