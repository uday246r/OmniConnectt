import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAuthStore } from '../../auth/store/authStore'
import { fieldTemplatesApi, type FieldTemplateDto } from '../api/fieldTemplatesApi'
import { setCatalogTemplates, FIELD_TEMPLATES, type FieldTemplate } from '../constants/fieldTemplates'
import { Icon } from '../../../shared/components/Icon/Icon'
import { SkeletonBlock } from '../../../shared/components/Skeleton'
import { ApiError } from '../../../shared/api/httpClient'
import { toast } from '../../../shared/stores/toastStore'
import { Button, Modal, Select, EmptyState } from '@omniconnect/ui'
import styles from './FieldTemplatesCard.module.css'

interface FieldTemplatesCardProps {
  canEdit: boolean
  onCountChange?: (count: number) => void
  onCatalogLoaded?: (templates: FieldTemplateDto[]) => void
}

type CategoryFilter = string

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
}

export function FieldTemplatesCard({ canEdit, onCountChange, onCatalogLoaded }: FieldTemplatesCardProps) {
  const accessToken = useAuthStore((s) => s.accessToken)
  const hasAccessToken = Boolean(accessToken)

  const [templates, setTemplates] = useState<FieldTemplateDto[]>([])
  const [originalTemplates, setOriginalTemplates] = useState<FieldTemplateDto[]>([])
  const [version, setVersion] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [conflict, setConflict] = useState(false)

  // Filters & search
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')

  // Modal editor state
  const [editorOpen, setEditorOpen] = useState(false)
  const [isCreating, setIsCreating] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<FieldTemplateDto | null>(null)
  const [formName, setFormName] = useState('')
  const [formLabel, setFormLabel] = useState('')
  const [formCategory, setFormCategory] = useState<string>('custom')
  const [formDataType, setFormDataType] = useState<'text' | 'dropdown'>('dropdown')
  const [formDesc, setFormDesc] = useState('')
  const [formOptions, setFormOptions] = useState<string[]>([])
  const [optionInput, setOptionInput] = useState('')
  const [optionSearch, setOptionSearch] = useState('')
  const [modalError, setModalError] = useState<string | null>(null)

  // Delete confirmation state
  const [deleteConfirm, setDeleteConfirm] = useState<FieldTemplateDto | null>(null)

  const load = useCallback(async () => {
    if (!accessToken) return
    setLoading(true)
    try {
      const res = await fieldTemplatesApi.get(accessToken)
      setTemplates(res.templates)
      setOriginalTemplates(res.templates)
      setVersion(res.version)
      setDirty(false)
      setConflict(false)
      setError(null)
      setCatalogTemplates(res.templates as unknown as FieldTemplate[])
      onCountChange?.(res.templates.length)
      onCatalogLoaded?.(res.templates)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load field templates catalog.')
    } finally {
      setLoading(false)
    }
  }, [hasAccessToken, onCountChange, onCatalogLoaded])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    onCountChange?.(templates.length)
  }, [templates.length, onCountChange])

  // Categories derived dynamically from catalog
  const categoriesList = useMemo(() => {
    const set = new Set<string>()
    templates.forEach((t) => {
      if (t.category) set.add(t.category.toLowerCase())
    })
    set.add('contact')
    set.add('custom')
    return ['all', ...Array.from(set)]
  }, [templates])

  // Filtered list
  const filteredTemplates = useMemo(() => {
    const q = search.trim().toLowerCase()
    return templates.filter((t) => {
      if (categoryFilter !== 'all' && t.category.toLowerCase() !== categoryFilter) {
        return false
      }
      if (!q) return true
      const matchName = t.name.toLowerCase().includes(q)
      const matchLabel = t.label.toLowerCase().includes(q)
      const matchDesc = t.description?.toLowerCase().includes(q) ?? false
      const matchOption = t.options?.some((o) => o.toLowerCase().includes(q)) ?? false
      return matchName || matchLabel || matchDesc || matchOption
    })
  }, [templates, search, categoryFilter])

  // Open modal to create a new template
  function handleOpenCreate() {
    setIsCreating(true)
    setEditingTemplate(null)
    setFormName('')
    setFormLabel('')
    setFormCategory('custom')
    setFormDataType('dropdown')
    setFormDesc('')
    setFormOptions([])
    setOptionInput('')
    setOptionSearch('')
    setModalError(null)
    setEditorOpen(true)
  }

  // Open modal to manage options / edit an existing template
  function handleOpenEdit(tmpl: FieldTemplateDto) {
    setIsCreating(false)
    setEditingTemplate(tmpl)
    setFormName(tmpl.name)
    setFormLabel(tmpl.label)
    setFormCategory(tmpl.category)
    setFormDataType(tmpl.dataType)
    setFormDesc(tmpl.description ?? '')
    setFormOptions(tmpl.options ? [...tmpl.options] : [])
    setOptionInput('')
    setOptionSearch('')
    setModalError(null)
    setEditorOpen(true)
  }

  // Option management inside modal
  function handleAddOption() {
    const trimmed = optionInput.trim()
    if (!trimmed) return

    // Allow comma or newline separated bulk input
    const parts = trimmed
      .split(/[\n,]+/)
      .map((s) => s.trim())
      .filter(Boolean)

    if (parts.length === 0) return

    const existingLower = new Set(formOptions.map((o) => o.toLowerCase()))
    const added: string[] = []
    let duplicates = 0

    for (const p of parts) {
      if (!existingLower.has(p.toLowerCase())) {
        existingLower.add(p.toLowerCase())
        added.push(p)
      } else {
        duplicates++
      }
    }

    if (added.length === 0 && duplicates > 0) {
      setModalError('Entered option(s) already exist.')
      return
    }

    setFormOptions((prev) => [...prev, ...added])
    setOptionInput('')
    setModalError(null)
  }

  function handleRemoveOption(optToRemove: string) {
    setFormOptions((prev) => prev.filter((o) => o !== optToRemove))
  }

  function handleSortOptions() {
    setFormOptions((prev) => [...prev].sort((a, b) => a.localeCompare(b)))
  }

  function handleResetSystemDefault() {
    if (!editingTemplate || !editingTemplate.isSystem) return
    const defaultTmpl = FIELD_TEMPLATES.find((t) => t.id === editingTemplate.id)
    if (defaultTmpl?.options) {
      setFormOptions([...defaultTmpl.options])
      setModalError(null)
      toast.info(`Reset "${editingTemplate.name}" to standard system options.`)
    }
  }

  // Save changes from modal back to draft state
  function handleApplyModal() {
    if (!formName.trim()) {
      setModalError('Template name is required.')
      return
    }
    if (!formLabel.trim()) {
      setModalError('Field label is required.')
      return
    }
    const isDynamic = Boolean(
      editingTemplate && (editingTemplate.id === 'contact-state' || editingTemplate.id === 'contact-city' || editingTemplate.id === 'contact-phone'),
    )
    if (formDataType === 'dropdown' && formOptions.length === 0 && !isDynamic) {
      setModalError('Dropdown templates require at least one option.')
      return
    }

    if (isCreating) {
      const generatedId = `custom-${slugify(formName)}-${Date.now().toString(36)}`
      const newTmpl: FieldTemplateDto = {
        id: generatedId,
        name: formName.trim(),
        label: formLabel.trim(),
        category: formCategory,
        dataType: formDataType,
        description: formDesc.trim() || undefined,
        options: formDataType === 'dropdown' ? formOptions : undefined,
        isSystem: false,
      }
      setTemplates((prev) => [...prev, newTmpl])
      setDirty(true)
      toast.info(`Template "${newTmpl.name}" created. Click "Save Changes" to persist.`)
    } else if (editingTemplate) {
      setTemplates((prev) =>
        prev.map((t) =>
          t.id === editingTemplate.id
            ? {
                ...t,
                name: t.isSystem ? t.name : formName.trim(),
                label: formLabel.trim(),
                category: t.isSystem ? t.category : formCategory,
                description: formDesc.trim() || undefined,
                options: t.dataType === 'dropdown' ? formOptions : undefined,
              }
            : t,
        ),
      )
      setDirty(true)
      toast.info(`Template "${editingTemplate.name}" updated. Click "Save Changes" to persist.`)
    }

    setEditorOpen(false)
  }

  function handleDeleteTemplate(tmpl: FieldTemplateDto) {
    if (tmpl.isSystem) {
      toast.error('System templates cannot be deleted.')
      return
    }
    setTemplates((prev) => prev.filter((t) => t.id !== tmpl.id))
    setDirty(true)
    setDeleteConfirm(null)
    toast.info(`Template "${tmpl.name}" removed. Click "Save Changes" to apply.`)
  }

  function handleDiscard() {
    setTemplates(originalTemplates)
    setCatalogTemplates(originalTemplates as unknown as FieldTemplate[])
    setDirty(false)
    toast.info('Discarded template changes.')
  }

  async function handleSaveChanges() {
    if (!accessToken) return
    setSaving(true)
    try {
      const res = await fieldTemplatesApi.update(accessToken, {
        templates,
        expectedVersion: version,
      })
      setTemplates(res.templates)
      setOriginalTemplates(res.templates)
      setVersion(res.version)
      setDirty(false)
      setCatalogTemplates(res.templates as unknown as FieldTemplate[])
      toast.success('Field templates catalog updated and saved to database.')
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        setConflict(true)
        setError(err.message)
      } else {
        toast.error(err instanceof ApiError ? err.message : 'Could not save field templates.')
      }
    } finally {
      setSaving(false)
    }
  }

  // Filtered options inside modal
  const filteredModalOptions = useMemo(() => {
    if (!optionSearch.trim()) return formOptions
    const q = optionSearch.trim().toLowerCase()
    return formOptions.filter((o) => o.toLowerCase().includes(q))
  }, [formOptions, optionSearch])

  return (
    <div className={styles.card}>
      {/* Header */}
      <div className={styles.cardHead}>
        <div className={styles.headLeft}>
          <div className={styles.headIcon}>
            <Icon.Layers width={18} height={18} />
          </div>
          <div className={styles.headTitleGroup}>
            <div className={styles.headTitleRow}>
              <h3 className={styles.headTitle}>Dropdown & Field Templates</h3>
              {!loading && <span className={styles.countBadge}>{templates.length}</span>}
            </div>
            <p className={styles.headSubtitle}>
              Pre-configured dropdown options and input templates stored in database. Add, remove, or customize options.
            </p>
          </div>
        </div>

        <div className={styles.headActions}>
          {canEdit && (
            <Button
              variant="secondary"
              leadingIcon={<Icon.Plus width={15} height={15} />}
              onClick={handleOpenCreate}
            >
              Create Template
            </Button>
          )}
          {canEdit && dirty && (
            <Button
              variant="primary"
              loading={saving}
              onClick={handleSaveChanges}
            >
              Save Changes
            </Button>
          )}
        </div>
      </div>

      {/* Error / Conflict Banner */}
      {error && (
        <div className={styles.errorBanner} role="alert">
          <Icon.AlertCircle width={18} height={18} />
          <span>{error}</span>
          {conflict && (
            <Button variant="secondary" size="sm" onClick={() => void load()}>
              Reload
            </Button>
          )}
        </div>
      )}

      {/* Toolbar */}
      <div className={styles.toolbar}>
        <div className={styles.searchBox}>
          <Icon.Search width={13} height={13} className={styles.searchIcon} />
          <input
            type="text"
            className={styles.searchInput}
            placeholder="Search templates or options (e.g. Country, India)..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button
              type="button"
              className={styles.searchClear}
              onClick={() => setSearch('')}
              aria-label="Clear search"
            >
              <Icon.X width={12} height={12} />
            </button>
          )}
        </div>

        <div className={styles.filterChips}>
          {categoriesList.map((cat) => (
            <button
              key={cat}
              type="button"
              className={`${styles.chip} ${categoryFilter === cat ? styles.chipActive : ''}`}
              onClick={() => setCategoryFilter(cat)}
            >
              {cat === 'all'
                ? 'All'
                : cat.charAt(0).toUpperCase() + cat.slice(1)}
              <span className={styles.chipCount}>
                {cat === 'all'
                  ? templates.length
                  : templates.filter((t) => t.category.toLowerCase() === cat).length}
              </span>
            </button>
          ))}
        </div>
      </div>

      {/* Templates Grid */}
      {loading ? (
        <div className={styles.templatesGrid}>
          {Array.from({ length: 4 }).map((_, i) => (
            <SkeletonBlock key={i} width="100%" height={160} radius="14px" />
          ))}
        </div>
      ) : filteredTemplates.length === 0 ? (
        <div className={styles.emptyStateWrap}>
          <EmptyState
            title={templates.length === 0 ? 'No templates found' : 'No matching templates'}
            description={
              templates.length === 0
                ? 'Create a custom template to provide pre-built dropdown options.'
                : 'No templates match your search or selected category filter.'
            }
            action={
              search || categoryFilter !== 'all' ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    setSearch('')
                    setCategoryFilter('all')
                  }}
                >
                  Reset Filters
                </Button>
              ) : undefined
            }
          />
        </div>
      ) : (
        <div className={styles.templatesGrid}>
          {filteredTemplates.map((tmpl) => {
            const isDynamicCascading = tmpl.id === 'contact-state' || tmpl.id === 'contact-city'
            const hasOptions = tmpl.dataType === 'dropdown' && Boolean(tmpl.options && tmpl.options.length > 0)
            const optionCount = tmpl.options?.length ?? 0
            const previewCount = 7
            const previewChips = tmpl.options ? tmpl.options.slice(0, previewCount) : []
            const remainingCount = optionCount - previewCount

            return (
              <div key={tmpl.id} className={styles.templateCard}>
                <div className={styles.templateCardTop}>
                  <div className={styles.templateIdentity}>
                    <div className={styles.templateIconBox}>
                      {tmpl.dataType === 'dropdown' ? (
                        <Icon.ChevronDown width={18} height={18} />
                      ) : (
                        <Icon.FileText width={18} height={18} />
                      )}
                    </div>
                    <div className={styles.templateTitleGroup}>
                      <span className={styles.templateName}>{tmpl.name}</span>
                      <span className={styles.templateCategoryTag}>
                        {tmpl.category} • {tmpl.dataType === 'dropdown' ? 'Dropdown' : 'Input Only'}
                      </span>
                    </div>
                  </div>

                  <div className={styles.badgeRow}>
                    {tmpl.isSystem ? (
                      <span className={styles.systemBadge} title="Built-in platform template">
                        <Icon.Lock width={11} height={11} />
                        System
                      </span>
                    ) : (
                      <span className={styles.customBadge} title="User-created custom template">
                        Custom
                      </span>
                    )}
                  </div>
                </div>

                {tmpl.description && <p className={styles.templateDesc}>{tmpl.description}</p>}

                {isDynamicCascading ? (
                  <div className={styles.optionsPreviewSection}>
                    <div className={styles.optionsPreviewHeader}>
                      <span className={styles.optionsCountLabel}>
                        Cascading Dynamic Options
                      </span>
                      <span className={styles.dynamicBadge}>
                        country-state-city
                      </span>
                    </div>
                    <div className={styles.dynamicDescWrap}>
                      <span className={styles.dynamicDescText}>
                        {tmpl.id === 'contact-state'
                          ? '⚡ Populates states & provinces dynamically based on selected country in user form.'
                          : '⚡ Populates cities dynamically based on selected state & country in user form.'}
                      </span>
                      <span className={styles.dynamicPreviewExamples}>
                        {tmpl.id === 'contact-state'
                          ? 'Examples: Maharashtra, California, Ontario, Bavaria, Queensland…'
                          : 'Examples: Mumbai, Los Angeles, Toronto, Munich, Sydney…'}
                      </span>
                    </div>
                  </div>
                ) : tmpl.dataType === 'dropdown' ? (
                  <div className={styles.optionsPreviewSection}>
                    <div className={styles.optionsPreviewHeader}>
                      <span className={styles.optionsCountLabel}>
                        Pre-configured Options ({optionCount})
                      </span>
                    </div>
                    {hasOptions ? (
                      <div className={styles.optionsChipsWrap}>
                        {previewChips.map((opt, idx) => (
                          <span key={`${opt}-${idx}`} className={styles.previewChip}>
                            {opt}
                          </span>
                        ))}
                        {remainingCount > 0 && (
                          <button
                            type="button"
                            className={styles.moreChipsPill}
                            onClick={() => handleOpenEdit(tmpl)}
                            title="Click to view and manage all options"
                          >
                            +{remainingCount} more...
                          </button>
                        )}
                      </div>
                    ) : (
                      <span className={styles.noOptionsMuted}>No options configured yet</span>
                    )}
                  </div>
                ) : tmpl.id === 'contact-postal-code' ? (
                  <div className={styles.optionsPreviewSection}>
                    <div className={styles.optionsPreviewHeader}>
                      <span className={styles.optionsCountLabel}>
                        Country-Aware Postal Validation
                      </span>
                      <span className={styles.dynamicBadge}>
                        postcode-validator
                      </span>
                    </div>
                    <div className={styles.dynamicDescWrap}>
                      <span className={styles.dynamicDescText}>
                        ⚡ Automatically validates postal/ZIP format based on selected Country in user form.
                      </span>
                      <span className={styles.dynamicPreviewExamples}>
                        Examples: 560001 (IN), 90210 (US), SW1A 1AA (GB), M5V 2T6 (CA)…
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className={styles.optionsPreviewSection}>
                    <span className={styles.noOptionsMuted}>
                      Text input template with single-line field configuration.
                    </span>
                  </div>
                )}

                <div className={styles.cardFooter}>
                  <button
                    type="button"
                    className={styles.manageBtn}
                    onClick={() => handleOpenEdit(tmpl)}
                  >
                    <Icon.Sliders width={13} height={13} />
                    <span>{isDynamicCascading ? 'Manage Template' : tmpl.dataType === 'dropdown' ? 'Manage Options' : 'Edit Template'}</span>
                  </button>

                  <div className={styles.btnGroup}>
                    {!tmpl.isSystem && canEdit && (
                      <button
                        type="button"
                        className={`${styles.iconBtn} ${styles.iconBtnDanger}`}
                        onClick={() => setDeleteConfirm(tmpl)}
                        title="Delete template"
                        aria-label="Delete template"
                      >
                        <Icon.Trash width={13} height={13} />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Sticky Save Bar */}
      {canEdit && dirty && (
        <div className={styles.saveBar}>
          <div className={styles.saveBarInfo}>
            <Icon.AlertCircle width={18} height={18} />
            <span>You have unsaved changes to dropdown templates.</span>
          </div>
          <div className={styles.saveBarActions}>
            <Button variant="secondary" size="sm" onClick={handleDiscard}>
              Discard
            </Button>
            <Button variant="primary" size="sm" loading={saving} onClick={handleSaveChanges}>
              Save Changes
            </Button>
          </div>
        </div>
      )}

      {/* Modal: Template & Option Editor */}
      {editorOpen && (
        <Modal
          open={editorOpen}
          size="lg"
          title={
            isCreating
              ? 'Create New Dropdown Template'
              : `Manage Template: ${editingTemplate?.name ?? ''}`
          }
          onClose={() => setEditorOpen(false)}
          actions={
            <>
              <Button variant="secondary" onClick={() => setEditorOpen(false)}>
                Cancel
              </Button>
              {canEdit && (
                <Button variant="primary" onClick={handleApplyModal}>
                  Apply Changes
                </Button>
              )}
            </>
          }
        >
          <div className={styles.modalForm}>
            {modalError && (
              <div className={styles.errorBanner} role="alert">
                <Icon.AlertCircle width={16} height={16} />
                <span>{modalError}</span>
              </div>
            )}

            <div className={styles.modalGrid}>
              <div className={styles.formGroup}>
                <label className={styles.label}>Template Name</label>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="e.g. Office Locations"
                  value={formName}
                  disabled={editingTemplate?.isSystem}
                  onChange={(e) => setFormName(e.target.value)}
                />
                {editingTemplate?.isSystem && (
                  <span className={styles.hint}>System template names are fixed.</span>
                )}
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Default Field Label</label>
                <input
                  type="text"
                  className={styles.input}
                  placeholder="e.g. Location"
                  value={formLabel}
                  onChange={(e) => setFormLabel(e.target.value)}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Category</label>
                <Select
                  value={formCategory}
                  disabled={editingTemplate?.isSystem}
                  onChange={(e) => setFormCategory(e.target.value)}
                  options={[
                    { value: 'custom', label: 'Custom' },
                    { value: 'contact', label: 'Contact' },
                  ]}
                />
              </div>

              <div className={styles.formGroup}>
                <label className={styles.label}>Data Type</label>
                <Select
                  value={formDataType}
                  disabled={!isCreating}
                  onChange={(e) => setFormDataType(e.target.value as 'text' | 'dropdown')}
                  options={[
                    { value: 'dropdown', label: 'Dropdown' },
                    { value: 'text', label: 'Text (Input Only)' },
                  ]}
                />
              </div>
            </div>

            <div className={styles.formGroup}>
              <label className={styles.label}>Description</label>
              <input
                type="text"
                className={styles.input}
                placeholder="Brief description of this template and its intended usage"
                value={formDesc}
                onChange={(e) => setFormDesc(e.target.value)}
              />
            </div>

            {/* Options Management Section (for Dropdowns) */}
            {formDataType === 'dropdown' && (
              <div className={styles.optionsManagerBox}>
                {(editingTemplate?.id === 'contact-state' || editingTemplate?.id === 'contact-city') && (
                  <div className={styles.dynamicTemplateBanner}>
                    <Icon.AlertCircle width={16} height={16} />
                    <span>
                      This cascading dropdown dynamically populates real-world options using <strong>country-state-city</strong>. Standard options are supplied automatically at runtime based on the user&apos;s selected country/state. You can optionally add custom fallback options below.
                    </span>
                  </div>
                )}
                <div className={styles.optionsManagerTop}>
                  <div className={styles.headTitleRow}>
                    <span className={styles.label}>Dropdown Options</span>
                    <span className={styles.optionsCountBadge}>
                      {formOptions.length} {formOptions.length === 1 ? 'Option' : 'Options'}
                    </span>
                  </div>

                  <div className={styles.optionsQuickActions}>
                    <button
                      type="button"
                      className={styles.quickActionTextBtn}
                      onClick={handleSortOptions}
                      title="Sort options alphabetically"
                    >
                      Sort A-Z
                    </button>
                    {editingTemplate?.isSystem && (
                      <button
                        type="button"
                        className={styles.quickActionTextBtn}
                        onClick={handleResetSystemDefault}
                        title="Restore original system options"
                      >
                        Reset Defaults
                      </button>
                    )}
                    {formOptions.length > 0 && (
                      <button
                        type="button"
                        className={styles.quickActionTextBtn}
                        onClick={() => setFormOptions([])}
                        title="Clear all options"
                      >
                        Clear All
                      </button>
                    )}
                  </div>
                </div>

                {canEdit && (
                  <div className={styles.addOptionRow}>
                    <input
                      type="text"
                      className={styles.addOptionInput}
                      placeholder="Add single option or paste comma-separated values (e.g. Remote, Hybrid, On-site)..."
                      value={optionInput}
                      onChange={(e) => setOptionInput(e.target.value)}
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
                      disabled={!optionInput.trim()}
                    >
                      Add Option
                    </Button>
                  </div>
                )}

                {formOptions.length > 6 && (
                  <div className={styles.optionsFilterBar}>
                    <input
                      type="text"
                      className={styles.optionsFilterInput}
                      placeholder={`Search within ${formOptions.length} options...`}
                      value={optionSearch}
                      onChange={(e) => setOptionSearch(e.target.value)}
                    />
                  </div>
                )}

                {formOptions.length === 0 ? (
                  <span className={styles.noOptionsMuted}>
                    No options in this template yet. Type an option above to add it.
                  </span>
                ) : (
                  <div className={styles.chipsContainer} role="list" aria-label="Template options">
                    {filteredModalOptions.map((opt, idx) => (
                      <div key={`${opt}-${idx}`} className={styles.chipItem} role="listitem">
                        <span>{opt}</span>
                        {canEdit && (
                          <button
                            type="button"
                            className={styles.chipRemoveBtn}
                            onClick={() => handleRemoveOption(opt)}
                            title={`Remove ${opt}`}
                            aria-label={`Remove ${opt}`}
                          >
                            ×
                          </button>
                        )}
                      </div>
                    ))}
                    {filteredModalOptions.length === 0 && (
                      <span className={styles.hint}>No options match "{optionSearch}"</span>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </Modal>
      )}

      {/* Delete Confirmation Modal */}
      {deleteConfirm && (
        <Modal
          open={Boolean(deleteConfirm)}
          title={`Delete Template "${deleteConfirm.name}"?`}
          size="sm"
          onClose={() => setDeleteConfirm(null)}
          actions={
            <>
              <Button variant="secondary" onClick={() => setDeleteConfirm(null)}>
                Cancel
              </Button>
              <Button variant="danger" onClick={() => handleDeleteTemplate(deleteConfirm)}>
                Delete Template
              </Button>
            </>
          }
        >
          <p style={{ margin: 0, fontSize: 13.5, color: '#475569', lineHeight: 1.5 }}>
            Are you sure you want to remove the template <strong>{deleteConfirm.name}</strong>? Existing fields using this
            template will retain their options, but this template will no longer be offered when creating or editing fields.
          </p>
        </Modal>
      )}
    </div>
  )
}
