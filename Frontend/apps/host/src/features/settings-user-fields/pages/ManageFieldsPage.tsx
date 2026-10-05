import { useEffect, useMemo, useState } from 'react'
import { useAuthStore, isSuperAdminOrAdmin } from '../../auth/store/authStore'
import { userSchemaApi } from '../api/userSchemaApi'
import { customPresetsApi } from '../api/customPresetsApi'
import { fieldTemplatesApi } from '../api/fieldTemplatesApi'
import { fieldSectionsApi, type FieldSection, type FieldSectionCatalogDto } from '../api/fieldSectionsApi'
import { FieldEditorModal } from '../components/FieldEditorModal'
import { SalutationsCard } from '../components/SalutationsCard'
import { FieldTemplatesCard } from '../components/FieldTemplatesCard'
import { FieldSectionsCard } from '../components/FieldSectionsCard'
import { Icon } from '../../../shared/components/Icon/Icon'
import { SkeletonBlock } from '../../../shared/components/Skeleton'
import { ApiError } from '../../../shared/api/httpClient'
import { toast } from '../../../shared/stores/toastStore'
import { Button, PageHeader, EmptyState, Select } from '@omniconnect/ui'
import type { CustomPreset, FieldDefinition } from '@omniconnect/ui/validation'
import { getTemplateById, setCatalogTemplates, type FieldTemplate } from '../constants/fieldTemplates'
import { FALLBACK_SECTIONS, arrangeFields, groupFieldsBySection, sectionLabel } from '../utils/sections'
import styles from './ManageFieldsPage.module.css'

type CategoryFilter = 'all' | 'required' | 'validated'
type FieldTabKey = 'custom' | 'core' | 'sections' | 'salutations' | 'templates'

function getFieldTypeLabel(field: FieldDefinition): string {
  switch (field.dataType) {
    case 'number': return 'Number'
    case 'boolean': return 'Toggle'
    case 'dropdown':
      return field.options && field.options.length > 0 ? `Dropdown (${field.options.length})` : 'Dropdown'
    default: return 'Text'
  }
}

function getFieldIcon(field: FieldDefinition) {
  if (field.dataType === 'dropdown') return <Icon.ChevronDown width={15} height={15} />
  const k = field.key.toLowerCase()
  if (k.includes('email')) return <Icon.Mail width={15} height={15} />
  if (k.includes('phone') || k.includes('mobile')) return <Icon.Phone width={15} height={15} />
  if (k.includes('name') || k.includes('user')) return <Icon.User width={15} height={15} />
  if (k.includes('id') || k.includes('code') || field.dataType === 'number') return <Icon.Hash width={15} height={15} />
  return <Icon.FileText width={15} height={15} />
}

function hydrateField(field: FieldDefinition): FieldDefinition {
  if (field.dataType === 'dropdown' && (!field.options || field.options.length === 0) && field.template) {
    const tmpl = getTemplateById(field.template)
    if (tmpl?.options && tmpl.options.length > 0) {
      return { ...field, options: [...tmpl.options] }
    }
  }
  return field
}

export function ManageFieldsPage() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const hasAccessToken = Boolean(accessToken)
  const isAdministrator = useAuthStore((s) => isSuperAdminOrAdmin(s.user))
  const hasCapability = useAuthStore((s) => s.hasCapability)
  const canEdit = isAdministrator || hasCapability('host.settings.users', 'Edit')

  const [activeTab, setActiveTab] = useState<FieldTabKey>('custom')
  const [salutationsCount, setSalutationsCount] = useState<number>(0)
  const [templatesCount, setTemplatesCount] = useState<number>(0)
  const [fields, setFields] = useState<FieldDefinition[]>([])
  const [originalFields, setOriginalFields] = useState<FieldDefinition[]>([])
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([])
  const [sections, setSections] = useState<FieldSection[]>(FALLBACK_SECTIONS)
  const [sectionsVersion, setSectionsVersion] = useState<number | undefined>(undefined)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>('all')
  const [sectionFilter, setSectionFilter] = useState<string>('all')

  const [editorState, setEditorState] = useState<{ open: boolean; field: FieldDefinition | null; section?: string }>({
    open: false,
    field: null,
  })

  const [version, setVersion] = useState<number | undefined>(undefined)

  async function load() {
    if (!accessToken) return
    setLoading(true)
    try {
      // Sections are NOT allowed to fail soft like templates are: with no catalog every field would
      // resolve to the default section, and the next Save would flatten the whole layout.
      const [schemaRes, presetsRes, templatesRes, sectionsRes] = await Promise.all([
        userSchemaApi.get(accessToken),
        customPresetsApi.get(accessToken),
        fieldTemplatesApi.get(accessToken).catch(() => null),
        fieldSectionsApi.get(accessToken),
      ])
      if (templatesRes) {
        setCatalogTemplates(templatesRes.templates as unknown as FieldTemplate[])
        setTemplatesCount(templatesRes.templates.length)
      }
      const arranged = arrangeFields(schemaRes.fields.map(hydrateField), sectionsRes.sections)
      setSections(sectionsRes.sections)
      setSectionsVersion(sectionsRes.version)
      setFields(arranged)
      setOriginalFields(arranged)
      setVersion(schemaRes.version)
      setCustomPresets(presetsRes.presets)
      setError(null)
      setDirty(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the user field schema.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [hasAccessToken])

  // Order is per section, renumbered from position — the admin never types a number, the layout IS
  // the order. Mirrors the server's Arrange so what is shown here is what will be stored.
  function withOrder(list: FieldDefinition[]): FieldDefinition[] {
    return arrangeFields(list, sections)
  }

  /** Swaps a custom field with its neighbour inside the same section. Core fields keep their slots, so
   *  the visible custom-field order changes without disturbing the locked ones between them. */
  function handleMove(key: string, delta: -1 | 1) {
    setFields((prev) => {
      const target = prev.find((f) => f.key === key)
      if (!target || target.core) return prev
      const siblings = prev.filter((f) => !f.core && f.section === target.section)
      const at = siblings.findIndex((f) => f.key === key)
      const neighbour = siblings[at + delta]
      if (!neighbour) return prev
      return withOrder(
        prev.map((f) =>
          f.key === target.key ? { ...f, order: neighbour.order }
            : f.key === neighbour.key ? { ...f, order: target.order }
              : f,
        ),
      )
    })
    setDirty(true)
  }

  /** Moves a field to another section, at the end of it. Only the section changes — key, rules and
   *  stored values are untouched. */
  function handleChangeSection(key: string, sectionKey: string) {
    setFields((prev) =>
      withOrder(prev.map((f) => (f.key === key ? { ...f, section: sectionKey, order: Number.MAX_SAFE_INTEGER } : f))),
    )
    setDirty(true)
  }

  /** A saved section change may have moved fields server-side (a delete with a destination), so the
   *  whole page reloads rather than trusting the local field list. */
  function handleSectionsSaved(catalog: FieldSectionCatalogDto) {
    setSections(catalog.sections)
    setSectionsVersion(catalog.version)
    void load()
  }

  function handleSaveField(field: FieldDefinition) {
    setFields((prev) => {
      const exists = prev.some((f) => f.key === field.key)
      const next = exists ? prev.map((f) => (f.key === field.key ? field : f)) : [...prev, field]
      return withOrder(next)
    })
    setDirty(true)
    setEditorState({ open: false, field: null })
  }

  function handleRemove(key: string) {
    setFields((prev) => withOrder(prev.filter((f) => f.key !== key)))
    setDirty(true)
  }

  function handleDiscard() {
    setFields(originalFields)
    setDirty(false)
    toast.info('Discarded unsaved field changes.')
  }

  async function handleSaveChanges() {
    if (!accessToken) return
    setSaving(true)
    try {
      const fieldsToSave = fields.map(hydrateField)
      const res = await userSchemaApi.update(accessToken, { fields: fieldsToSave, expectedVersion: version })
      const arranged = arrangeFields(res.fields.map(hydrateField), sections)
      setFields(arranged)
      setOriginalFields(arranged)
      setVersion(res.version)
      setDirty(false)
      toast.success('User fields updated. User profile forms now reflect these changes.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save the field changes.')
    } finally {
      setSaving(false)
    }
  }

  const coreFields = useMemo(() => fields.filter((f) => f.core), [fields])
  const customFields = useMemo(() => fields.filter((f) => !f.core), [fields])

  const sectionOptions = useMemo(
    () => [...sections].sort((a, b) => a.order - b.order).map((s) => ({ value: s.key, label: s.label })),
    [sections],
  )

  const filteredCustomFields = useMemo(() => {
    const q = search.trim().toLowerCase()
    return customFields.filter((f) => {
      if (categoryFilter === 'required' && !f.required) return false
      if (categoryFilter === 'validated' && f.validations.length === 0) return false
      if (sectionFilter !== 'all' && f.section !== sectionFilter) return false
      if (!q) return true
      return (
        f.label.toLowerCase().includes(q) ||
        f.key.toLowerCase().includes(q) ||
        sectionLabel(f.section, sections).toLowerCase().includes(q)
      )
    })
  }, [customFields, search, categoryFilter, sectionFilter, sections])

  // Reordering inside a filtered view would move a field past neighbours the admin cannot see.
  const filtersActive = search.trim() !== '' || categoryFilter !== 'all' || sectionFilter !== 'all'

  const customGroups = useMemo(
    () => groupFieldsBySection(filteredCustomFields, sections, { skipEmpty: filtersActive }),
    [filteredCustomFields, sections, filtersActive],
  )

  return (
    <div className={styles.page}>
      <PageHeader
        icon={<Icon.FileText width={22} height={22} />}
        title="Manage Fields"
        subtitle="Configure user profile schema, field requirements, and custom validation rules."
        actions={
          canEdit && (
            activeTab === 'custom' ? (
              <Button
                variant="primary"
                leadingIcon={<Icon.Plus width={16} height={16} />}
                onClick={() => setEditorState({ open: true, field: null })}
              >
                Add Custom Field
              </Button>
            ) : activeTab === 'salutations' ? (
              <Button
                variant="primary"
                leadingIcon={<Icon.Plus width={16} height={16} />}
                onClick={() => {
                  const input = document.getElementById('salutation-new-input')
                  input?.focus()
                  input?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }}
              >
                Add Salutation
              </Button>
            ) : null
          )
        }
      />

      {/* 4 Standardized KPI Summary Cards */}
      <div className={styles.summaryGrid}>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconBlue}`}>
            <Icon.Layers width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Total Fields</span>
            <span className={styles.summaryValue}>{loading ? '—' : fields.length}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconPurple}`}>
            <Icon.Sliders width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Custom Attributes</span>
            <span className={styles.summaryValue}>{loading ? '—' : customFields.length}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconAmber}`}>
            <Icon.AlertCircle width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Mandatory Fields</span>
            <span className={styles.summaryValue}>{loading ? '—' : fields.filter((f) => f.required).length}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconGreen}`}>
            <Icon.CheckCircle width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Active Rules</span>
            <span className={styles.summaryValue}>
              {loading ? '—' : fields.reduce((s, f) => s + f.validations.length, 0)}
            </span>
          </div>
        </div>
      </div>

      {error && (
        <div className={styles.errorBanner} role="alert">
          <Icon.AlertCircle width={18} height={18} />
          <span>{error}</span>
        </div>
      )}

      {/* Tab Navigation Strip */}
      <div className={styles.navBar}>
        <div className={styles.tabList} role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'custom'}
            className={`${styles.tabBtn} ${activeTab === 'custom' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('custom')}
          >
            <Icon.Sliders width={15} height={15} />
            <span>Custom Attributes</span>
            <span className={styles.tabBadge}>{customFields.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'core'}
            className={`${styles.tabBtn} ${activeTab === 'core' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('core')}
          >
            <Icon.Lock width={15} height={15} />
            <span>Core System Fields</span>
            <span className={styles.tabBadge}>{coreFields.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'sections'}
            className={`${styles.tabBtn} ${activeTab === 'sections' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('sections')}
          >
            <Icon.Layers width={15} height={15} />
            <span>Sections</span>
            <span className={styles.tabBadge}>{sections.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'salutations'}
            className={`${styles.tabBtn} ${activeTab === 'salutations' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('salutations')}
          >
            <Icon.Users width={15} height={15} />
            <span>Salutations</span>
            {salutationsCount > 0 && <span className={styles.tabBadge}>{salutationsCount}</span>}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'templates'}
            className={`${styles.tabBtn} ${activeTab === 'templates' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('templates')}
          >
            <Icon.Layers width={15} height={15} />
            <span>Dropdown Templates</span>
            {templatesCount > 0 && <span className={styles.tabBadge}>{templatesCount}</span>}
          </button>
        </div>
      </div>

      {/* Tab Panels */}
      {activeTab === 'custom' && (
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <div className={styles.headLeft}>
              <div className={styles.headIcon} data-color="blue">
                <Icon.Sliders width={18} height={18} />
              </div>
              <div className={styles.headTitleGroup}>
                <div className={styles.headTitleRow}>
                  <h3 className={styles.headTitle}>Custom Attributes</h3>
                  {!loading && <span className={styles.countBadge}>{customFields.length}</span>}
                </div>
                <p className={styles.headSubtitle}>Organization-defined profile fields and validation rules</p>
              </div>
            </div>
            {canEdit && (
              <button
                type="button"
                className={styles.addBtn}
                onClick={() => setEditorState({ open: true, field: null })}
              >
                <Icon.Plus width={14} height={14} />
                Add Field
              </button>
            )}
          </div>

          {/* Toolbar */}
          <div className={styles.toolbar}>
            <div className={styles.searchBox}>
              <Icon.Search width={13} height={13} className={styles.searchIcon} />
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search by label or key…"
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
              {(['all', 'required', 'validated'] as const).map((f) => (
                <button
                  key={f}
                  type="button"
                  className={`${styles.chip} ${categoryFilter === f ? styles.chipActive : ''}`}
                  onClick={() => setCategoryFilter(f)}
                >
                  {f === 'all' ? 'All' : f === 'required' ? 'Required' : 'With Rules'}
                  <span className={styles.chipCount}>
                    {f === 'all'
                      ? customFields.length
                      : f === 'required'
                        ? customFields.filter((cf) => cf.required).length
                        : customFields.filter((cf) => cf.validations.length > 0).length}
                  </span>
                </button>
              ))}
            </div>

            <div style={{ width: 180 }}>
              <Select
                value={sectionFilter}
                onChange={(e) => setSectionFilter(e.target.value)}
                options={[{ value: 'all', label: 'All Sections' }, ...sectionOptions]}
              />
            </div>
          </div>

          {/* Column Headers for Tabular Precision */}
          <div className={styles.tableHeader}>
            <span>Field</span>
            <span>Section</span>
            <span>Data Type</span>
            <span>Requirement</span>
            <span>Rules</span>
            <span className={styles.thAction}>Actions</span>
          </div>

          {/* Custom Fields List */}
          <div className={styles.fieldsList}>
            {loading ? (
              <div className={styles.skeletons}>
                {Array.from({ length: 3 }).map((_, i) => (
                  <SkeletonBlock key={i} width="100%" height={52} radius="8px" />
                ))}
              </div>
            ) : filteredCustomFields.length === 0 ? (
              <div className={styles.emptyWrap}>
                <EmptyState
                  title={customFields.length === 0 ? 'No custom fields yet' : 'No matching fields'}
                  description={
                    customFields.length === 0
                      ? 'Create your first custom attribute to capture organization-specific profile data.'
                      : 'No fields match your search or selected filter.'
                  }
                  action={
                    search || categoryFilter !== 'all' || sectionFilter !== 'all' ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setSearch('')
                          setCategoryFilter('all')
                          setSectionFilter('all')
                        }}
                      >
                        Reset Filters
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              customGroups.map(({ section, fields: groupFields }) => (
                <div key={section.key} className={styles.sectionGroup}>
                  <div className={styles.sectionGroupHead}>
                    <span className={styles.sectionGroupTitle}>
                      <Icon.Layers width={13} height={13} />
                      {section.label}
                    </span>
                    <span className={styles.sectionGroupCount}>
                      {groupFields.length} {groupFields.length === 1 ? 'field' : 'fields'}
                    </span>
                    {canEdit && (
                      <button
                        type="button"
                        className={styles.groupAddBtn}
                        onClick={() => setEditorState({ open: true, field: null, section: section.key })}
                        aria-label={`Add a field to ${section.label}`}
                      >
                        <Icon.Plus width={12} height={12} />
                        Add field
                      </button>
                    )}
                  </div>
                  {groupFields.length === 0 ? (
                    <div className={styles.emptyGroup}>No custom fields in this section yet.</div>
                  ) : (
                    groupFields.map((field, position) => (
                    <div key={field.key} className={styles.fieldGridRow}>
                      {/* Col 1: Identity */}
                      <div className={styles.fieldIdentity}>
                        <div className={styles.fieldIconBox}>{getFieldIcon(field)}</div>
                        <div className={styles.fieldTextGroup}>
                          <span className={styles.fieldLabel}>{field.label}</span>
                          <span className={styles.fieldKey}>{field.key}</span>
                        </div>
                      </div>

                      {/* Col 2: Section */}
                      <div>
                        {canEdit ? (
                          <Select
                            aria-label={`Section for ${field.label}`}
                            value={field.section ?? ''}
                            onChange={(e) => handleChangeSection(field.key, e.target.value)}
                            options={sectionOptions}
                          />
                        ) : (
                          <span className={styles.sectionBadge}>
                            <Icon.Layers width={11} height={11} />
                            {sectionLabel(field.section, sections)}
                          </span>
                        )}
                      </div>

                      {/* Col 3: Data Type */}
                      <div>
                        <span className={styles.typeBadge}>{getFieldTypeLabel(field)}</span>
                      </div>

                      {/* Col 4: Requirement */}
                      <div>
                        {field.required ? (
                          <span className={styles.reqBadgeRequired}>Required</span>
                        ) : (
                          <span className={styles.reqBadgeOptional}>Optional</span>
                        )}
                      </div>

                      {/* Col 5: Rules / Options */}
                      <div>
                        {field.dataType === 'dropdown' ? (
                          <span className={styles.ruleBadgeActive} title={`${field.options?.length ?? 0} options configured`}>
                            <Icon.Check width={12} height={12} />
                            {field.options?.length ?? 0} {field.options?.length === 1 ? 'Option' : 'Options'}
                          </span>
                        ) : field.validations.length > 0 ? (
                          <span className={styles.ruleBadgeActive}>
                            <Icon.Check width={12} height={12} />
                            {field.validations.length} {field.validations.length === 1 ? 'Rule' : 'Rules'}
                          </span>
                        ) : (
                          <span className={styles.ruleBadgeNone}>—</span>
                        )}
                      </div>

                      {/* Col 6: Actions */}
                      <div className={styles.actionGroup}>
                        {canEdit && (
                          <>
                            <button
                              type="button"
                              className={styles.actionBtn}
                              onClick={() => handleMove(field.key, -1)}
                              disabled={filtersActive || position === 0}
                              aria-label={`Move ${field.label} up`}
                              title={filtersActive ? 'Clear filters to reorder' : 'Move up within this section'}
                            >
                              <Icon.ChevronUp width={13} height={13} />
                            </button>
                            <button
                              type="button"
                              className={styles.actionBtn}
                              onClick={() => handleMove(field.key, 1)}
                              disabled={filtersActive || position === groupFields.length - 1}
                              aria-label={`Move ${field.label} down`}
                              title={filtersActive ? 'Clear filters to reorder' : 'Move down within this section'}
                            >
                              <Icon.ChevronDown width={13} height={13} />
                            </button>
                          </>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            className={styles.actionBtn}
                            onClick={() => setEditorState({ open: true, field })}
                            title="Edit field settings and rules"
                          >
                            <Icon.Edit width={13} height={13} />
                          </button>
                        )}
                        {canEdit && (
                          <button
                            type="button"
                            className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                            onClick={() => handleRemove(field.key)}
                            title="Delete custom field"
                          >
                            <Icon.Trash width={13} height={13} />
                          </button>
                        )}
                      </div>
                    </div>
                    ))
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {activeTab === 'core' && (
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <div className={styles.headLeft}>
              <div className={styles.headIcon} data-color="purple">
                <Icon.Lock width={18} height={18} />
              </div>
              <div className={styles.headTitleGroup}>
                <div className={styles.headTitleRow}>
                  <h3 className={styles.headTitle}>Core System Fields</h3>
                  <span className={styles.systemBadge}>Locked</span>
                </div>
                <p className={styles.headSubtitle}>Platform identity schema — non-removable. Validation rules can be configured.</p>
              </div>
            </div>
          </div>

          <div className={styles.coreTableHeader}>
            <span>Field</span>
            <span>Section</span>
            <span>Identifier</span>
            <span>Status</span>
            <span>Validation Rules</span>
            <span className={styles.thAction}>Actions</span>
          </div>

          <div className={styles.fieldsList}>
            {loading ? (
              <div className={styles.skeletons}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonBlock key={i} width="100%" height={48} radius="8px" />
                ))}
              </div>
            ) : (
              coreFields.map((field) => (
                <div key={field.key} className={styles.coreGridRow}>
                  {/* Identity */}
                  <div className={styles.fieldIdentity}>
                    <div className={styles.fieldIconBox} data-core="true">
                      {getFieldIcon(field)}
                    </div>
                    <div className={styles.fieldTextGroup}>
                      <span className={styles.fieldLabel}>{field.label}</span>
                    </div>
                  </div>

                  {/* Section */}
                  <div>
                    <span className={styles.sectionBadge}>
                      <Icon.Layers width={11} height={11} />
                      {sectionLabel(field.section, sections)}
                    </span>
                  </div>

                  {/* Key */}
                  <div>
                    <span className={styles.fieldKey}>{field.key}</span>
                  </div>

                  {/* Status */}
                  <div>
                    <span className={styles.systemBadge}>Core</span>
                  </div>

                  {/* Validations */}
                  <div>
                    {field.validations.length > 0 ? (
                      <span className={styles.ruleBadgeActive}>
                        <Icon.Check width={12} height={12} />
                        {field.validations.length} {field.validations.length === 1 ? 'Rule' : 'Rules'}
                      </span>
                    ) : (
                      <span className={styles.ruleBadgeNone}>Default standard</span>
                    )}
                  </div>

                  {/* Actions */}
                  <div className={styles.actionGroup}>
                    {canEdit && (
                      <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={() => setEditorState({ open: true, field })}
                        title="Configure validation rules for this core field"
                      >
                        <Icon.Edit width={13} height={13} />
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      <div style={{ display: activeTab === 'salutations' ? 'block' : 'none' }}>
        <SalutationsCard canEdit={canEdit} onCountChange={setSalutationsCount} />
      </div>

      <div style={{ display: activeTab === 'templates' ? 'block' : 'none' }}>
        <FieldTemplatesCard canEdit={canEdit} onCountChange={setTemplatesCount} />
      </div>

      {activeTab === 'sections' && (
        <FieldSectionsCard
          canEdit={canEdit}
          sections={sections}
          version={sectionsVersion}
          fields={fields}
          fieldsDirty={dirty}
          onSaved={handleSectionsSaved}
        />
      )}

      {/* Sticky Save Bar */}
      {canEdit && dirty && (
        <div className={styles.saveBar}>
          <div className={styles.saveBarInfo}>
            <Icon.AlertCircle width={18} height={18} />
            <span>You have unsaved changes to the field schema.</span>
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

      <FieldEditorModal
        open={editorState.open}
        field={editorState.field}
        existingKeys={fields.map((f) => f.key)}
        customPresets={customPresets}
        sections={sections}
        initialSection={editorState.section}
        onSave={handleSaveField}
        onClose={() => setEditorState({ open: false, field: null })}
      />
    </div>
  )
}
