import { useMemo, useRef, useState } from 'react'
import { Combobox, type ComboboxOption } from '../primitives/Combobox/Combobox'
import {
  CUSTOM_PRESET_ID,
  FIELD_PRESETS,
  PRESET_GROUP_LABELS,
  findPreset,
  testRule,
  type CustomPreset,
  type ValidationRule,
} from '../validation'
import styles from './ValidationRulesEditor.module.css'

export interface ValidationRulesEditorProps {
  rules: ValidationRule[]
  onChange: (rules: ValidationRule[]) => void
  /** Formats from Settings → Manage Formats, offered beside the built-in ones. */
  customPresets: CustomPreset[]
  /** Heading above the list. */
  title?: string
}

const LENGTH_RULES = new Set(['minLength', 'maxLength', 'exactLength'])

let nextId = 0
const newId = () => `rule-${++nextId}`

/**
 * Why a rule list cannot be saved, in words an administrator can act on — or null when it can.
 *
 * The same checks the servers make (UserFieldSchemaAppService, LeadFieldConfigService.EnsureRulesWellFormed),
 * so a problem is shown on the form instead of coming back as a failed save.
 */
export function describeRuleProblem(rules: ValidationRule[]): string | null {
  for (const rule of rules) {
    if (!rule.message?.trim()) return 'Every format needs the message people see when it is not met.'
    if (rule.type === CUSTOM_PRESET_ID) {
      if (!rule.pattern?.trim()) return 'Every custom pattern needs a regular expression.'
      try {
        new RegExp(rule.pattern)
      } catch {
        return `"${rule.pattern}" is not valid regular expression syntax.`
      }
    }
    if (LENGTH_RULES.has(rule.type) && !(Number(rule.value) > 0)) {
      return 'A length format needs a number of characters above zero.'
    }
  }
  return null
}

/**
 * The one editor for a field's format rules — used by Manage Fields for user fields and by Lead
 * Management's Field Settings for lead fields.
 *
 * It lived inside the host's field editor, so Lead Management had no way to set a format at all and
 * its checks were hard-coded. One component means an administrator sees the same choices, the same
 * wording and the same live tester wherever a field's format is set.
 */
export function ValidationRulesEditor({ rules, onChange, customPresets, title = 'Formats' }: ValidationRulesEditorProps) {
  // Stable keys for the rows, so a sample value typed into one tester stays with its rule when another is removed.
  const ids = useRef<string[]>([])
  while (ids.current.length < rules.length) ids.current.push(newId())
  ids.current.length = rules.length

  const [samples, setSamples] = useState<Record<string, string>>({})
  const [addChoice, setAddChoice] = useState('')

  const addOptions = useMemo<ComboboxOption[]>(() => {
    const used = new Set(rules.map((r) => r.type))
    const builtIn = FIELD_PRESETS.filter((p) => !used.has(p.id)).map((p) => ({
      value: p.id,
      label: p.label,
      description: `e.g. ${p.example.valid}`,
      group: PRESET_GROUP_LABELS[p.group],
    }))
    const admin = customPresets.filter((p) => !used.has(p.key)).map((p) => ({
      value: p.key,
      label: p.label,
      group: 'Formats from Manage Formats',
    }))
    const custom = used.has(CUSTOM_PRESET_ID)
      ? []
      : [{ value: CUSTOM_PRESET_ID, label: 'One-off custom pattern (regular expression)', group: PRESET_GROUP_LABELS.custom }]
    return [...builtIn, ...admin, ...custom]
  }, [rules, customPresets])

  function add(type: string) {
    if (!type) return
    const admin = customPresets.find((p) => p.key === type)
    const preset = findPreset(type)
    const rule: ValidationRule =
      type === CUSTOM_PRESET_ID
        ? { type, pattern: '', message: 'Enter a valid value.' }
        : admin
          ? { type, message: admin.message }
          : { type, message: preset?.defaultMessage ?? 'Enter a valid value.' }
    if (LENGTH_RULES.has(type)) rule.value = type === 'minLength' ? 2 : type === 'maxLength' ? 50 : 10
    ids.current.push(newId())
    onChange([...rules, rule])
    setAddChoice('')
  }

  function update(index: number, patch: Partial<ValidationRule>) {
    onChange(rules.map((r, i) => (i === index ? { ...r, ...patch } : r)))
  }

  function remove(index: number) {
    const [id] = ids.current.splice(index, 1)
    setSamples(({ [id]: _, ...rest }) => rest)
    onChange(rules.filter((_, i) => i !== index))
  }

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <span className={styles.label}>{title}</span>
        {rules.length === 0 && <span className={styles.hint}>No format — any value is accepted.</span>}
      </div>

      {rules.map((rule, index) => {
        const id = ids.current[index]
        const name =
          rule.type === CUSTOM_PRESET_ID
            ? 'Custom pattern'
            : findPreset(rule.type)?.label ?? customPresets.find((p) => p.key === rule.type)?.label ?? 'A format that no longer exists'
        const sample = samples[id] ?? ''
        const result = sample ? testRule(rule, sample, customPresets) : null
        return (
          <div key={id} className={styles.card}>
            <div className={styles.cardHeader}>
              <span className={styles.name}>{name}</span>
              <button type="button" className={styles.remove} onClick={() => remove(index)} aria-label={`Remove ${name}`}>
                ×
              </button>
            </div>

            {rule.type === CUSTOM_PRESET_ID && (
              <label className={styles.field}>
                <span className={styles.labelSm}>Regular expression</span>
                <input
                  className={styles.inputMono}
                  placeholder="^EMP-[0-9]{4}$"
                  value={rule.pattern ?? ''}
                  onChange={(e) => update(index, { pattern: e.target.value })}
                />
              </label>
            )}

            {LENGTH_RULES.has(rule.type) && (
              <label className={styles.field}>
                <span className={styles.labelSm}>
                  {rule.type === 'minLength' ? 'Minimum characters' : rule.type === 'maxLength' ? 'Maximum characters' : 'Exact number of characters'}
                </span>
                <input
                  type="number"
                  min={1}
                  className={styles.input}
                  value={rule.value ?? ''}
                  onChange={(e) => update(index, { value: Number(e.target.value) || undefined })}
                />
              </label>
            )}

            <label className={styles.field}>
              <span className={styles.labelSm}>Message shown when the value is not in this format</span>
              <input className={styles.input} value={rule.message} onChange={(e) => update(index, { message: e.target.value })} />
            </label>

            <div className={styles.tester}>
              <input
                className={styles.testerInput}
                aria-label={`Try a value against ${name}`}
                placeholder="Type a sample value to try this format…"
                value={sample}
                onChange={(e) => setSamples((prev) => ({ ...prev, [id]: e.target.value }))}
              />
              {result && (
                <span className={result.ok ? styles.pass : styles.fail} role="status">
                  {result.ok ? '✓ Passes' : `✗ ${result.message}`}
                </span>
              )}
            </div>
          </div>
        )
      })}

      <Combobox
        aria-label="Add a format"
        placeholder="+ Add a format…"
        options={addOptions}
        value={addChoice}
        onChange={add}
        emptyMessage="No format by that name"
      />
    </div>
  )
}
