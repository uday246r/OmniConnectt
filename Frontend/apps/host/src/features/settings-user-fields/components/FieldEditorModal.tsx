import { useEffect, useMemo, useState } from 'react'
import {
  FIELD_PRESETS,
  type CustomPreset,
  type FieldDefinition,
  type ValidationRule,
} from '@omniconnect/ui/validation'
import { ValidationRulesEditor, describeRuleProblem } from '@omniconnect/ui/validation-editor'
import { Button, Modal, Select } from '@omniconnect/ui'
import { Icon } from '../../../shared/components/Icon/Icon'
import { toast } from '../../../shared/stores/toastStore'
import { useAuthStore } from '../../auth/store/authStore'
import { fieldTemplatesApi, type FieldTemplateDto } from '../api/fieldTemplatesApi'
import { getCatalogTemplates, setCatalogTemplates, getTemplateById, type FieldTemplate } from '../constants/fieldTemplates'
import type { FieldSection } from '../api/fieldSectionsApi'
import { FALLBACK_SECTIONS, resolveSectionKey } from '../utils/sections'
import styles from './FieldEditorModal.module.css'

interface FieldEditorModalProps {
  open: boolean
  /** null = adding a new (always custom, never core) field. */
  field: FieldDefinition | null
  existingKeys: string[]
  /** Admin-defined formats from Settings > Manage Formats — offered in the rule picker alongside the
   * built-in catalog. */
  customPresets: CustomPreset[]
  /** The admin-managed section catalog. Optional so a caller without one still gets the default section. */
  sections?: FieldSection[]
  /** Section key to preselect when adding a field (e.g. the section whose "Add Field" was clicked). */
  initialSection?: string
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

function describeRule(rule: ValidationRule, customPresets: CustomPreset[]): { name: string; detail?: string } {
  if (rule.type === 'custom') {
    return { name: 'Custom Regex', detail: rule.pattern ?? undefined }
  }
  if (rule.type === 'minLength') {
    return { name: 'Min Length', detail: `≥ ${rule.value ?? 1} chars` }
  }
  if (rule.type === 'maxLength') {
    return { name: 'Max Length', detail: `≤ ${rule.value ?? 50} chars` }
  }
  if (rule.type === 'exactLength') {
    return { name: 'Exact Length', detail: `${rule.value ?? 10} chars` }
  }
  const custom = customPresets.find((p) => p.key === rule.type)
  if (custom) {
    return { name: custom.label, detail: custom.pattern ?? undefined }
  }
  const builtIn = FIELD_PRESETS.find((p) => p.id === rule.type)
  if (builtIn) {
    return { name: builtIn.label }
  }
  return { name: rule.type }
}

export function FieldEditorModal({
  open,
  field,
  existingKeys,
  customPresets,
  sections = FALLBACK_SECTIONS,
  initialSection,
  onSave,
  onClose,
}: FieldEditorModalProps) {
  const accessToken = useAuthStore((s) => s.accessToken)
  const isEdit = field !== null
  const isCore = field?.core ?? false

  const [label, setLabel] = useState('')
  const [required, setRequired] = useState(true)
  const [dataType, setDataType] = useState<'text' | 'dropdown'>('text')
  const [options, setOptions] = useState<string[]>([])
  const [templatesList, setTemplatesList] = useState<FieldTemplate[]>(getCatalogTemplates())
  const [selectedTemplate, setSelectedTemplate] = useState<string>('')
  const [sectionKey, setSectionKey] = useState<string>(() => resolveSectionKey(initialSection, sections))
  const [newOption, setNewOption] = useState('')
  const [optionsFilter, setOptionsFilter] = useState('')
  const [rules, setRules] = useState<ValidationRule[]>([])
  const [error, setError] = useState<string | null>(null)
  const [savingTemplate, setSavingTemplate] = useState(false)

  useEffect(() => {
    if (!open) return
    if (accessToken) {
      void fieldTemplatesApi
        .get(accessToken)
        .then((res) => {
          const list = res.templates as unknown as FieldTemplate[]
          setCatalogTemplates(list)
          setTemplatesList(list)
        })
        .catch(() => {})
    }
    setLabel(field?.label ?? '')
    setRequired(field?.required ?? true)
    setDataType(field?.dataType === 'dropdown' ? 'dropdown' : 'text')

    // A stored value may be a legacy label or point at a since-deleted section; resolving it means the
    // select always shows a real section, never a blank.
    setSectionKey(resolveSectionKey(field?.section ?? initialSection, sections))

    let initialOptions = field?.options ? [...field.options] : []
    const tmplId = field?.template ?? ''
    if (initialOptions.length === 0 && tmplId) {
      const tmpl = getTemplateById(tmplId)
      if (tmpl?.options && tmpl.options.length > 0) {
        initialOptions = [...tmpl.options]
      }
    }
    setOptions(initialOptions)
    setSelectedTemplate(tmplId)
    setNewOption('')
    setOptionsFilter('')
    setRules(field?.validations ?? [])
    setError(null)
  }, [open, field, accessToken, initialSection, sections])

  const key = useMemo(() => field?.key ?? slugify(label), [field, label])

  const templateSelectOptions = useMemo(() => {
    return [
      { value: '', label: 'Custom (No Template)' },
      ...templatesList.map((t) => ({
        value: t.id,
        label: `${t.name} (${t.dataType === 'dropdown' ? 'Dropdown' : 'Text'})`,
      })),
    ]
  }, [templatesList])

  const sectionSelectOptions = useMemo(
    () => [...sections].sort((a, b) => a.order - b.order).map((s) => ({ value: s.key, label: s.label })),
    [sections],
  )

  async function handleSaveAsTemplate() {
    if (!accessToken || options.length === 0 || !label.trim()) return
    setSavingTemplate(true)
    try {
      const res = await fieldTemplatesApi.get(accessToken)
      const newTmplName = `${label.trim()} Template`
      const newTmplId = `custom-${slugify(label)}-${Date.now().toString(36)}`
      const newTemplateItem: FieldTemplateDto = {
        id: newTmplId,
        name: newTmplName,
        label: label.trim(),
        key: slugify(label),
        category: 'custom',
        dataType: 'dropdown',
        description: `Custom template created from field "${label.trim()}"`,
        options: [...options],
        isSystem: false,
      }
      const updatedTemplates: FieldTemplateDto[] = [...res.templates, newTemplateItem]
      const savedRes = await fieldTemplatesApi.update(accessToken, {
        templates: updatedTemplates,
        expectedVersion: res.version,
      })
      const fullList = savedRes.templates as unknown as FieldTemplate[]
      setCatalogTemplates(fullList)
      setTemplatesList(fullList)
      setSelectedTemplate(newTmplId)
      toast.success(`Saved "${newTmplName}" as a reusable dropdown template!`)
    } catch {
      toast.error('Could not save as reusable template.')
    } finally {
      setSavingTemplate(false)
    }
  }

  function handleTemplateSelect(templateId: string) {
    setSelectedTemplate(templateId)
    if (!templateId) return
    const tmpl = getTemplateById(templateId)
    if (tmpl) {
      setLabel(tmpl.label)
      setDataType(tmpl.dataType)
      // Only honour a template's suggested section if it still exists — an admin may have deleted or
      // renamed "Address", and a suggestion must never override the section they are adding to.
      if (tmpl.defaultSection && sections.some((s) => s.key === tmpl.defaultSection)) {
        setSectionKey(tmpl.defaultSection)
      }
      if (tmpl.options) {
        setOptions([...tmpl.options])
      } else {
        setOptions([])
      }
      setError(null)
    }
  }

  function handleAddOption() {
    const trimmed = newOption.trim()
    if (!trimmed) return
    if (options.some((o) => o.toLowerCase() === trimmed.toLowerCase())) {
      setError(`Option "${trimmed}" already exists.`)
      return
    }
    setOptions((prev) => [...prev, trimmed])
    setNewOption('')
    setError(null)
  }

  function handleRemoveOption(optToRemove: string) {
    setOptions((prev) => prev.filter((o) => o !== optToRemove))
  }

  function handleResetTemplate() {
    if (!selectedTemplate) return
    const tmpl = getTemplateById(selectedTemplate)
    if (tmpl?.options) {
      setOptions([...tmpl.options])
      setError(null)
    }
  }

  const filteredOptions = useMemo(() => {
    if (!optionsFilter.trim()) return options
    const q = optionsFilter.toLowerCase().trim()
    return options.filter((o) => o.toLowerCase().includes(q))
  }, [options, optionsFilter])

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

    const isDynamicDropdown =
      selectedTemplate === 'contact-state' ||
      selectedTemplate === 'contact-city' ||
      selectedTemplate === 'contact-phone' ||
      key === 'state' ||
      key === 'city' ||
      key === 'stateProvince' ||
      label.toLowerCase().includes('state') ||
      label.toLowerCase().includes('province') ||
      label.toLowerCase().includes('city')

    if (!isCore && dataType === 'dropdown' && !isDynamicDropdown) {
      if (options.length === 0) {
        setError('Dropdown fields require at least one option.')
        return
      }
    } else if (dataType !== 'dropdown') {
      const ruleProblem = describeRuleProblem(rules)
      if (ruleProblem) {
        setError(ruleProblem)
        return
      }
    }

    onSave({
      key,
      label: label.trim(),
      core: isCore,
      dataType: isCore ? (field?.dataType ?? 'text') : dataType,
      options: !isCore && dataType === 'dropdown' ? (isDynamicDropdown && options.length === 0 ? [] : options) : undefined,
      template: !isCore && selectedTemplate ? selectedTemplate : undefined,
      required: isCore ? true : required,
      order: field?.order ?? 0,
      validations: (!isCore && dataType === 'dropdown') ? [] : rules,
      section: sectionKey,
    })
  }

  return (
    <Modal
      open={open}
      size="lg"
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

        {/* Template Selector (shown when creating or editing a non-core field) */}
        {!isCore && (
          <div className={styles.formGroup}>
            <label className={styles.label} htmlFor="field-template-select">
              Template (Pre-configured)
            </label>
            <Select
              id="field-template-select"
              value={selectedTemplate}
              onChange={(e) => handleTemplateSelect(e.target.value)}
              options={templateSelectOptions}
              placeholder="Choose a template (optional)..."
            />
            <span className={styles.hint}>
              Select a template like "Country (Contact Template)" to auto-fill the field name and values.
            </span>
          </div>
        )}

        {/* Form Section Selector */}
        {!isCore && (
          <div className={styles.formGroup}>
            <label className={styles.label} htmlFor="field-section-select">
              Form Section
            </label>
            <Select
              id="field-section-select"
              value={sectionKey}
              onChange={(e) => setSectionKey(e.target.value)}
              options={sectionSelectOptions}
            />
            <span className={styles.hint}>
              Which section of the user form this field appears in. Sections are managed in the Sections tab.
            </span>
          </div>
        )}

        {/* Field Type Selector (Text Input vs Dropdown) */}
        {!isCore && (
          <div className={styles.formGroup}>
            <label className={styles.label}>Field Type</label>
            <div className={styles.typeSelector} role="radiogroup" aria-label="Field Type">
              <button
                type="button"
                role="radio"
                aria-checked={dataType === 'text'}
                className={`${styles.typeCard} ${dataType === 'text' ? styles.typeCardActive : ''}`}
                onClick={() => { setDataType('text'); setError(null) }}
              >
                <div className={styles.typeCardIcon}>
                  <Icon.FileText width={18} height={18} />
                </div>
                <div className={styles.typeCardContent}>
                  <span className={styles.typeCardTitle}>Input Only</span>
                  <span className={styles.typeCardDesc}>Single-line text input with custom validation rules</span>
                </div>
              </button>

              <button
                type="button"
                role="radio"
                aria-checked={dataType === 'dropdown'}
                className={`${styles.typeCard} ${dataType === 'dropdown' ? styles.typeCardActive : ''}`}
                onClick={() => { setDataType('dropdown'); setError(null) }}
              >
                <div className={styles.typeCardIcon}>
                  <Icon.ChevronDown width={18} height={18} />
                </div>
                <div className={styles.typeCardContent}>
                  <span className={styles.typeCardTitle}>Dropdown</span>
                  <span className={styles.typeCardDesc}>Searchable dropdown populated with predefined choices</span>
                </div>
              </button>
            </div>
          </div>
        )}

        <div className={styles.formGroup}>
          <label className={styles.label}>Label</label>
          <input
            type="text"
            className={styles.input}
            placeholder="e.g. Aadhar Number or Country"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            autoFocus
          />
          {!isCore && (
            <span className={styles.hint}>Internal ID: {key || <em>(type a label above)</em>}</span>
          )}
          {isCore && (
            <span className={styles.hint}>
              <Icon.Lock width={12} height={12} /> Core field — used to sign in / contact this user, so it can't be removed.
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

        {/* Dropdown Options Manager (when Dropdown is selected) */}
        {!isCore && dataType === 'dropdown' && (
          <div className={styles.optionsCard}>
            <div className={styles.optionsHeader}>
              <div className={styles.optionsTitleGroup}>
                <Icon.CheckCircle width={16} height={16} />
                <span className={styles.optionsTitle}>Dropdown Options</span>
                <span className={styles.optionsBadge}>
                  {options.length} {options.length === 1 ? 'Option' : 'Options'}
                </span>
              </div>
              <div className={styles.optionsActions}>
                {selectedTemplate && (
                  <button
                    type="button"
                    className={styles.textActionBtn}
                    onClick={handleResetTemplate}
                  >
                    Reset Template
                  </button>
                )}
                {options.length > 0 && (
                  <button
                    type="button"
                    className={styles.saveTemplateBtn}
                    disabled={savingTemplate}
                    onClick={handleSaveAsTemplate}
                    title="Save these options as a reusable dropdown template in the database"
                  >
                    <Icon.Plus width={12} height={12} />
                    <span>{savingTemplate ? 'Saving...' : 'Save as Template'}</span>
                  </button>
                )}
                {options.length > 0 && (
                  <button
                    type="button"
                    className={styles.textActionBtn}
                    onClick={() => setOptions([])}
                  >
                    Clear All
                  </button>
                )}
              </div>
            </div>

            <div className={styles.addOptionRow}>
              <input
                type="text"
                className={styles.addOptionInput}
                placeholder="Add option and press Enter (e.g. India)"
                value={newOption}
                onChange={(e) => setNewOption(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    handleAddOption()
                  }
                }}
              />
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleAddOption}
                disabled={!newOption.trim()}
              >
                Add Option
              </Button>
            </div>

            {options.length > 5 && (
              <input
                type="text"
                className={styles.optionsFilterInput}
                placeholder={`Search ${options.length} options...`}
                value={optionsFilter}
                onChange={(e) => setOptionsFilter(e.target.value)}
              />
            )}

            {options.length === 0 ? (
              <div className={styles.emptyOptionsNotice}>
                {selectedTemplate === 'contact-state'
                  ? 'Cascading state/province options are populated dynamically at runtime based on the user’s selected country (via country-state-city).'
                  : selectedTemplate === 'contact-city'
                  ? 'Cascading city options are populated dynamically at runtime based on the user’s selected state and country (via country-state-city).'
                  : 'No options added yet. Add options above or select a template like "Country" to load pre-built options.'}
              </div>
            ) : (
              <div className={styles.optionsChipsList} role="list" aria-label="Configured options">
                {filteredOptions.map((opt, idx) => (
                  <div key={`${opt}-${idx}`} className={styles.optionChip} role="listitem">
                    <span>{opt}</span>
                    <button
                      type="button"
                      className={styles.optionChipRemove}
                      onClick={() => handleRemoveOption(opt)}
                      aria-label={`Remove ${opt}`}
                      title={`Remove ${opt}`}
                    >
                      ×
                    </button>
                  </div>
                ))}
                {filteredOptions.length === 0 && (
                  <span className={styles.hint}>No options match "{optionsFilter}"</span>
                )}
              </div>
            )}
          </div>
        )}

        {/* Currently Present Rules Section (shown when editing a text field with rules) */}
        {isEdit && dataType === 'text' && (
          <div className={styles.activeRulesSummary}>
            <div className={styles.activeRulesHeader}>
              <div className={styles.activeRulesTitle}>
                <Icon.CheckCircle width={16} height={16} />
                <span>Currently Active Rules on Field</span>
              </div>
              <span className={styles.activeRulesBadge}>
                {rules.length} {rules.length === 1 ? 'Rule' : 'Rules'}
              </span>
            </div>

            {rules.length === 0 ? (
              <div className={styles.noRulesHint}>
                <Icon.AlertCircle width={14} height={14} />
                <span>No validation rules currently configured. Any input format is accepted.</span>
              </div>
            ) : (
              <div className={styles.activeRulesList}>
                {rules.map((rule, idx) => {
                  const info = describeRule(rule, customPresets)
                  return (
                    <div key={idx} className={styles.activeRuleChip}>
                      <span className={styles.activeRuleChipIcon}>
                        <Icon.Check width={13} height={13} />
                      </span>
                      <span className={styles.activeRuleChipName}>Rule #{idx + 1}: {info.name}</span>
                      {info.detail && <span className={styles.activeRuleChipDetail}>{info.detail}</span>}
                      {rule.message && <span className={styles.activeRuleChipMsg}>"{rule.message}"</span>}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* Configure / Edit Validation Rules (for Text fields only) */}
        {dataType === 'text' && (
          <div className={styles.rulesSection}>
            <ValidationRulesEditor
              title="Validation Rules"
              rules={rules}
              onChange={setRules}
              customPresets={customPresets}
            />
          </div>
        )}
      </div>
    </Modal>
  )
}
