import { useEffect, useMemo, useState } from 'react'
import { useAuthStore, isSuperAdminOrAdmin } from '../../auth/store/authStore'
import { customPresetsApi } from '../api/customPresetsApi'
import { FormatEditorModal } from '../components/FormatEditorModal'
import { Icon } from '../../../shared/components/Icon/Icon'
import { SkeletonBlock } from '../../../shared/components/Skeleton'
import { ApiError } from '../../../shared/api/httpClient'
import { toast } from '../../../shared/stores/toastStore'
import { Button, PageHeader, EmptyState } from '@omniconnect/ui'
import { FIELD_PRESETS, PRESET_GROUP_LABELS, type CustomPreset, type CustomPresetKind } from '@omniconnect/ui/validation'
import styles from './ManageFormatsPage.module.css'

type KindFilter = 'all' | CustomPresetKind
type FormatTabKey = 'custom' | 'builtin'

const KIND_LABELS: Record<CustomPresetKind, string> = {
  regex: 'Regex',
  lengthRange: 'Length',
  numericRange: 'Numeric',
  textPattern: 'Text Type',
}

const KIND_COLOR: Record<CustomPresetKind, string> = {
  regex: 'blue',
  lengthRange: 'amber',
  numericRange: 'amber',
  textPattern: 'green',
}

function getKindIcon(kind: CustomPresetKind) {
  switch (kind) {
    case 'regex': return <Icon.Code width={14} height={14} />
    case 'textPattern': return <Icon.Type width={14} height={14} />
    case 'lengthRange': return <Icon.Maximize2 width={14} height={14} />
    case 'numericRange': return <Icon.Hash width={14} height={14} />
  }
}

function summarizeShort(preset: CustomPreset): string {
  switch (preset.kind) {
    case 'regex': return preset.pattern || '—'
    case 'lengthRange': {
      if (preset.minLength != null && preset.maxLength != null) return `${preset.minLength}–${preset.maxLength} chars`
      if (preset.minLength != null) return `≥ ${preset.minLength} chars`
      if (preset.maxLength != null) return `≤ ${preset.maxLength} chars`
      return '—'
    }
    case 'numericRange': {
      if (preset.minValue != null && preset.maxValue != null) return `${preset.minValue}–${preset.maxValue}`
      if (preset.minValue != null) return `≥ ${preset.minValue}`
      if (preset.maxValue != null) return `≤ ${preset.maxValue}`
      return '—'
    }
    case 'textPattern': return preset.textMode ?? '—'
    default: return ''
  }
}

function getGroupIcon(group: 'textShape' | 'format' | 'length') {
  switch (group) {
    case 'textShape': return <Icon.Type width={14} height={14} />
    case 'format': return <Icon.CheckCircle width={14} height={14} />
    case 'length': return <Icon.Maximize2 width={14} height={14} />
  }
}

export function ManageFormatsPage() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const hasAccessToken = Boolean(accessToken)
  const isAdministrator = useAuthStore((s) => isSuperAdminOrAdmin(s.user))
  const hasCapability = useAuthStore((s) => s.hasCapability)
  const canEdit = isAdministrator || hasCapability('host.settings.users', 'Edit')

  const [activeTab, setActiveTab] = useState<FormatTabKey>('custom')
  const [presets, setPresets] = useState<CustomPreset[]>([])
  const [originalPresets, setOriginalPresets] = useState<CustomPreset[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [search, setSearch] = useState('')
  const [kindFilter, setKindFilter] = useState<KindFilter>('all')

  const [editorState, setEditorState] = useState<{ open: boolean; preset: CustomPreset | null }>({
    open: false,
    preset: null,
  })
  const [version, setVersion] = useState<number | undefined>(undefined)

  async function load() {
    if (!accessToken) return
    setLoading(true)
    try {
      const res = await customPresetsApi.get(accessToken)
      setPresets(res.presets)
      setOriginalPresets(res.presets)
      setVersion(res.version)
      setError(null)
      setDirty(false)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the format catalog.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void load() }, [hasAccessToken])

  function handleSavePreset(preset: CustomPreset) {
    setPresets((prev) => {
      const exists = prev.some((p) => p.key === preset.key)
      return exists ? prev.map((p) => (p.key === preset.key ? preset : p)) : [...prev, preset]
    })
    setDirty(true)
    setEditorState({ open: false, preset: null })
  }

  function handleRemove(key: string) {
    setPresets((prev) => prev.filter((p) => p.key !== key))
    setDirty(true)
  }

  function handleDiscard() {
    setPresets(originalPresets)
    setDirty(false)
    toast.info('Discarded unsaved format changes.')
  }

  async function handleSaveChanges() {
    if (!accessToken) return
    setSaving(true)
    try {
      const res = await customPresetsApi.update(accessToken, { presets, expectedVersion: version })
      setPresets(res.presets)
      setOriginalPresets(res.presets)
      setVersion(res.version)
      setDirty(false)
      toast.success('Formats updated. Available in the validation rule picker.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save the format changes.')
    } finally {
      setSaving(false)
    }
  }

  const filteredPresets = useMemo(() => {
    const q = search.trim().toLowerCase()
    return presets.filter((p) => {
      if (kindFilter !== 'all' && p.kind !== kindFilter) return false
      if (!q) return true
      return (
        p.label.toLowerCase().includes(q) ||
        p.key.toLowerCase().includes(q) ||
        (p.pattern && p.pattern.toLowerCase().includes(q))
      )
    })
  }, [presets, search, kindFilter])

  function handleCopySpec(spec: string) {
    if (!spec || spec === '—') return
    void navigator.clipboard.writeText(spec)
    toast.success(`Copied pattern "${spec}" to clipboard.`)
  }

  const countByKind = (kind: CustomPresetKind) => presets.filter((p) => p.kind === kind).length

  return (
    <div className={styles.page}>
      <PageHeader
        icon={<Icon.Key width={22} height={22} />}
        title="Manage Formats"
        subtitle="Built-in platform standards and custom validation format presets."
        actions={
          canEdit && activeTab === 'custom' && (
            <Button
              variant="primary"
              leadingIcon={<Icon.Plus width={16} height={16} />}
              onClick={() => setEditorState({ open: true, preset: null })}
            >
              Add Custom Format
            </Button>
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
            <span className={styles.summaryLabel}>Total Formats</span>
            <span className={styles.summaryValue}>{FIELD_PRESETS.length + presets.length}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconPurple}`}>
            <Icon.Sliders width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Custom Formats</span>
            <span className={styles.summaryValue}>{loading ? '—' : presets.length}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconCyan}`}>
            <Icon.Lock width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Platform Standards</span>
            <span className={styles.summaryValue}>{FIELD_PRESETS.length}</span>
          </div>
        </div>
        <div className={styles.summaryCard}>
          <div className={`${styles.summaryIcon} ${styles.iconGreen}`}>
            <Icon.Code width={20} height={20} />
          </div>
          <div className={styles.summaryContent}>
            <span className={styles.summaryLabel}>Active Regex</span>
            <span className={styles.summaryValue}>{loading ? '—' : countByKind('regex')}</span>
          </div>
        </div>
      </div>

      {error && <div className={styles.errorBanner} role="alert">{error}</div>}

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
            <span>Custom Formats</span>
            <span className={styles.tabBadge}>{presets.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'builtin'}
            className={`${styles.tabBtn} ${activeTab === 'builtin' ? styles.tabBtnActive : ''}`}
            onClick={() => setActiveTab('builtin')}
          >
            <Icon.Lock width={15} height={15} />
            <span>Built-in Formats</span>
            <span className={styles.tabBadge}>{FIELD_PRESETS.length}</span>
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
                  <h3 className={styles.headTitle}>Custom Formats</h3>
                  {!loading && <span className={styles.countBadge}>{presets.length}</span>}
                </div>
                <p className={styles.headSubtitle}>User-defined regex patterns, length ranges, and numeric constraints</p>
              </div>
            </div>
            {canEdit && (
              <button
                type="button"
                className={styles.addBtn}
                onClick={() => setEditorState({ open: true, preset: null })}
              >
                <Icon.Plus width={14} height={14} />
                Add Format
              </button>
            )}
          </div>

          {/* Search + Kind Filter Tabs */}
          <div className={styles.toolbar}>
            <div className={styles.searchBox}>
              <Icon.Search width={13} height={13} className={styles.searchIcon} />
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Search formats by label, key, or pattern…"
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
              <button
                type="button"
                className={`${styles.chip} ${kindFilter === 'all' ? styles.chipActive : ''}`}
                onClick={() => setKindFilter('all')}
              >
                All <span className={styles.chipCount}>{presets.length}</span>
              </button>
              {(['regex', 'lengthRange', 'numericRange', 'textPattern'] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  className={`${styles.chip} ${kindFilter === k ? styles.chipActive : ''}`}
                  onClick={() => setKindFilter(k)}
                >
                  {KIND_LABELS[k]}
                  <span className={styles.chipCount}>{countByKind(k)}</span>
                </button>
              ))}
            </div>
          </div>

          {/* Column Header */}
          <div className={styles.tableHeader}>
            <span>Format Label</span>
            <span>Technical Key</span>
            <span>Pattern / Specification</span>
            <span>Constraint Type</span>
            <span className={styles.thAction}>Actions</span>
          </div>

          {/* Format rows */}
          <div className={styles.formatList}>
            {loading ? (
              <div className={styles.skeletons}>
                {Array.from({ length: 4 }).map((_, i) => (
                  <SkeletonBlock key={i} width="100%" height={52} radius="8px" />
                ))}
              </div>
            ) : filteredPresets.length === 0 ? (
              <div className={styles.emptyWrap}>
                <EmptyState
                  title={presets.length === 0 ? 'No custom formats yet' : 'No matching formats'}
                  description={
                    presets.length === 0
                      ? 'Add your first custom format to reuse it across profile validation rules.'
                      : 'No custom formats matched your search or selected filter.'
                  }
                  action={
                    search || kindFilter !== 'all' ? (
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          setSearch('')
                          setKindFilter('all')
                        }}
                      >
                        Reset Filters
                      </Button>
                    ) : undefined
                  }
                />
              </div>
            ) : (
              filteredPresets.map((preset) => {
                const specText = summarizeShort(preset)
                return (
                  <div key={preset.key} className={styles.formatGridRow}>
                    {/* Label */}
                    <div className={styles.formatIdentity}>
                      <div className={styles.formatRowIcon} data-kind={preset.kind}>
                        {getKindIcon(preset.kind)}
                      </div>
                      <div className={styles.formatTextGroup}>
                        <span className={styles.formatLabel}>{preset.label}</span>
                      </div>
                    </div>

                    {/* Key */}
                    <div>
                      <span className={styles.formatKey}>{preset.key}</span>
                    </div>

                    {/* Spec with copy button */}
                    <div>
                      <button
                        type="button"
                        className={styles.formatSpec}
                        onClick={() => handleCopySpec(specText)}
                        title="Click to copy pattern / specification"
                      >
                        <Icon.Copy width={11} height={11} className={styles.copyIcon} />
                        <span>{specText}</span>
                      </button>
                    </div>

                    {/* Kind Tag */}
                    <div>
                      <span className={styles.kindTag} data-color={KIND_COLOR[preset.kind]}>
                        {KIND_LABELS[preset.kind]}
                      </span>
                    </div>

                  {/* Actions */}
                  <div className={styles.actionGroup}>
                    {canEdit && (
                      <button
                        type="button"
                        className={styles.actionBtn}
                        onClick={() => setEditorState({ open: true, preset })}
                        title="Edit format"
                      >
                        <Icon.Edit width={13} height={13} />
                      </button>
                    )}
                    {canEdit && (
                      <button
                        type="button"
                        className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                        onClick={() => handleRemove(preset.key)}
                        title="Remove format"
                      >
                        <Icon.Trash width={13} height={13} />
                      </button>
                    )}
                  </div>
                </div>
              )
            })
            )}
          </div>
        </div>
      )}

      {activeTab === 'builtin' && (
        <div className={styles.card}>
          <div className={styles.cardHead}>
            <div className={styles.headLeft}>
              <div className={styles.headIcon} data-color="purple">
                <Icon.Lock width={18} height={18} />
              </div>
              <div className={styles.headTitleGroup}>
                <div className={styles.headTitleRow}>
                  <h3 className={styles.headTitle}>Built-in System Formats</h3>
                  <span className={styles.systemBadge}>Platform Standards</span>
                </div>
                <p className={styles.headSubtitle}>Immutable platform validation rules — available across all fields</p>
              </div>
            </div>
          </div>

          <div className={styles.builtinBody}>
            {(['textShape', 'format', 'length'] as const).map((group) => {
              const items = FIELD_PRESETS.filter((p) => p.group === group)
              return (
                <div key={group} className={styles.builtinGroup}>
                  <div className={styles.builtinGroupLabel}>
                    {getGroupIcon(group)}
                    <span>{PRESET_GROUP_LABELS[group]}</span>
                  </div>
                  <div className={styles.builtinChips}>
                    {items.map((p) => (
                      <span key={p.id} className={styles.builtinChip} title={p.defaultMessage}>
                        {p.label}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Sticky save bar */}
      {canEdit && dirty && (
        <div className={styles.saveBar}>
          <div className={styles.saveBarInfo}>
            <Icon.AlertCircle width={18} height={18} />
            <span>You have unsaved changes to custom formats.</span>
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

      <FormatEditorModal
        open={editorState.open}
        preset={editorState.preset}
        existingKeys={presets.map((p) => p.key)}
        onSave={handleSavePreset}
        onClose={() => setEditorState({ open: false, preset: null })}
      />
    </div>
  )
}
