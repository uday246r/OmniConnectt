import { useEffect, useState } from 'react'
import { testCustomPreset, type CustomPreset, type CustomPresetKind, type TextPatternMode } from '@omniremit/ui/validation'
import { Button, Modal, Select } from '@omniremit/ui'
import styles from './FieldEditorModal.module.css'

const TEXT_PATTERN_MODE_LABELS: Record<TextPatternMode, string> = {
  lettersOnly: 'Letters only',
  lettersAndSpaces: 'Letters & spaces',
  alphanumeric: 'Letters & numbers (alphanumeric)',
  noSpecialCharacters: 'Letters, numbers & spaces (no symbols)',
  digitsOnly: 'Digits only',
}

interface FormatEditorModalProps {
  open: boolean
  /** null = creating a new format. */
  preset: CustomPreset | null
  existingKeys: string[]
  onSave: (preset: CustomPreset) => void
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

const KIND_LABELS: Record<CustomPresetKind, string> = {
  textPattern: 'Text / String Type',
  regex: 'Custom Pattern (Regex)',
  lengthRange: 'Character Length Range',
  numericRange: 'Numeric Value Range',
}

export function FormatEditorModal({ open, preset, existingKeys, onSave, onClose }: FormatEditorModalProps) {
  const isEdit = preset !== null

  const [label, setLabel] = useState('')
  const [kind, setKind] = useState<CustomPresetKind>('textPattern')
  const [pattern, setPattern] = useState('')
  const [minLength, setMinLength] = useState('')
  const [maxLength, setMaxLength] = useState('')
  const [minValue, setMinValue] = useState('')
  const [maxValue, setMaxValue] = useState('')
  const [textMode, setTextMode] = useState<TextPatternMode>('lettersAndSpaces')
  const [message, setMessage] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [testValue, setTestValue] = useState('')

  useEffect(() => {
    if (!open) return
    setLabel(preset?.label ?? '')
    setKind(preset?.kind ?? 'textPattern')
    setPattern(preset?.pattern ?? '')
    setMinLength(preset?.minLength != null ? String(preset.minLength) : '')
    setMaxLength(preset?.maxLength != null ? String(preset.maxLength) : '')
    setMinValue(preset?.minValue != null ? String(preset.minValue) : '')
    setMaxValue(preset?.maxValue != null ? String(preset.maxValue) : '')
    setTextMode(preset?.textMode ?? 'lettersAndSpaces')
    setMessage(preset?.message ?? 'This value is not in the allowed format.')
    setError(null)
    setTestValue('')
  }, [open, preset])

  const key = preset?.key ?? slugify(label)

  function buildPreset(): CustomPreset {
    return {
      key,
      label: label.trim(),
      kind,
      pattern: kind === 'regex' ? pattern.trim() : undefined,
      minLength: kind === 'lengthRange' && minLength !== '' ? Number(minLength) : undefined,
      maxLength: kind === 'lengthRange' && maxLength !== '' ? Number(maxLength) : undefined,
      minValue: kind === 'numericRange' && minValue !== '' ? Number(minValue) : undefined,
      maxValue: kind === 'numericRange' && maxValue !== '' ? Number(maxValue) : undefined,
      textMode: kind === 'textPattern' ? textMode : undefined,
      message: message.trim(),
    }
  }

  const testResult = testValue ? testCustomPreset(buildPreset(), testValue) : null

  function handleSave() {
    if (!label.trim()) {
      setError('Label is required.')
      return
    }
    if (!isEdit && (!key || existingKeys.includes(key))) {
      setError(!key ? 'Enter a label made of letters.' : 'A format with this internal key already exists — try a slightly different label.')
      return
    }
    if (!message.trim()) {
      setError('Enter the error message people should see when this format rejects a value.')
      return
    }
    if (kind === 'regex') {
      if (!pattern.trim()) {
        setError('Enter a regular expression.')
        return
      }
      try {
        // eslint-disable-next-line no-new
        new RegExp(pattern)
      } catch {
        setError(`"${pattern}" is not valid regular expression syntax.`)
        return
      }
    }
    if (kind === 'lengthRange' && minLength === '' && maxLength === '') {
      setError('Enter a minimum and/or maximum length.')
      return
    }
    if (kind === 'lengthRange' && minLength !== '' && maxLength !== '' && Number(minLength) > Number(maxLength)) {
      setError('Minimum length cannot exceed maximum length.')
      return
    }
    if (kind === 'numericRange' && minValue === '' && maxValue === '') {
      setError('Enter a minimum and/or maximum value.')
      return
    }
    if (kind === 'numericRange' && minValue !== '' && maxValue !== '' && Number(minValue) > Number(maxValue)) {
      setError('Minimum value cannot exceed maximum value.')
      return
    }

    onSave(buildPreset())
  }

  return (
    <Modal
      open={open}
      title={isEdit ? `Edit "${preset?.label}"` : 'Add Format'}
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={handleSave}>{isEdit ? 'Save Format' : 'Add Format'}</Button>
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
            placeholder="e.g. Employee Code"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            autoFocus
          />
          <span className={styles.hint}>Internal ID: {key || <em>(type a label above)</em>}</span>
        </div>

        <div className={styles.formGroup}>
          <label className={styles.label} htmlFor="format-kind">Format Type</label>
          <Select
            id="format-kind"
            value={kind}
            onChange={(e) => setKind(e.target.value as CustomPresetKind)}
            options={(Object.keys(KIND_LABELS) as CustomPresetKind[]).map((k) => ({ value: k, label: KIND_LABELS[k] }))}
          />
        </div>

        {kind === 'textPattern' && (
          <div className={styles.formGroup}>
            <label className={styles.labelSm} htmlFor="format-text-mode">Allowed characters</label>
            <Select
              id="format-text-mode"
              value={textMode}
              onChange={(e) => setTextMode(e.target.value as TextPatternMode)}
              options={(Object.keys(TEXT_PATTERN_MODE_LABELS) as TextPatternMode[]).map((m) => ({ value: m, label: TEXT_PATTERN_MODE_LABELS[m] }))}
            />
            <span className={styles.hintInline}>No regex needed — pick the kind of text this field should accept.</span>
          </div>
        )}

        {kind === 'regex' && (
          <div className={styles.formGroup}>
            <label className={styles.labelSm}>Regular expression</label>
            <input
              type="text"
              className={styles.inputMono}
              placeholder="^EMP-[0-9]{4}$"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
            />
          </div>
        )}

        {kind === 'lengthRange' && (
          <div className={styles.formGroupRow2}>
            <div className={styles.formGroup}>
              <label className={styles.labelSm}>Minimum characters</label>
              <input type="number" min={0} className={styles.input} value={minLength} onChange={(e) => setMinLength(e.target.value)} />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.labelSm}>Maximum characters</label>
              <input type="number" min={0} className={styles.input} value={maxLength} onChange={(e) => setMaxLength(e.target.value)} />
            </div>
          </div>
        )}

        {kind === 'numericRange' && (
          <div className={styles.formGroupRow2}>
            <div className={styles.formGroup}>
              <label className={styles.labelSm}>Minimum value</label>
              <input type="number" className={styles.input} value={minValue} onChange={(e) => setMinValue(e.target.value)} placeholder="e.g. 6000000000" />
            </div>
            <div className={styles.formGroup}>
              <label className={styles.labelSm}>Maximum value</label>
              <input type="number" className={styles.input} value={maxValue} onChange={(e) => setMaxValue(e.target.value)} placeholder="e.g. 9999999999" />
            </div>
          </div>
        )}
        {kind === 'numericRange' && (
          <span className={styles.hintInline}>
            The value people type is read as a plain number — good for things like a numeric ID or account
            number range, not a formatted phone number.
          </span>
        )}

        <div className={styles.formGroup}>
          <label className={styles.labelSm}>Error message shown to the person filling the form</label>
          <input type="text" className={styles.input} value={message} onChange={(e) => setMessage(e.target.value)} />
        </div>

        <div className={styles.testerRow}>
          <input
            type="text"
            className={styles.testerInput}
            placeholder="Type a sample value to test this format..."
            value={testValue}
            onChange={(e) => setTestValue(e.target.value)}
          />
          {testResult && (
            <span className={testResult.ok ? styles.testerPass : styles.testerFail}>
              {testResult.ok ? 'Passes' : testResult.message}
            </span>
          )}
        </div>
      </div>
    </Modal>
  )
}
