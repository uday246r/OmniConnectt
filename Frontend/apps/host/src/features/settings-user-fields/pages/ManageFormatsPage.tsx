import { useEffect, useState } from 'react'
import { useAuthStore } from '../../auth/store/authStore'
import { customPresetsApi } from '../api/customPresetsApi'
import { FormatEditorModal } from '../components/FormatEditorModal'
import { Icon } from '../../../shared/components/Icon/Icon'
import { SkeletonBlock } from '../../../shared/components/Skeleton'
import { ApiError } from '../../../shared/api/httpClient'
import { toast } from '../../../shared/stores/toastStore'
import { Button, PageHeader } from '@omniremit/ui'
import { FIELD_PRESETS, PRESET_GROUP_LABELS, type CustomPreset, type CustomPresetKind } from '@omniremit/ui/validation'
import styles from './ManageFormatsPage.module.css'

const KIND_BADGE_LABELS: Record<CustomPresetKind, string> = {
  regex: 'Regex',
  lengthRange: 'Length Range',
  numericRange: 'Numeric Range',
  textPattern: 'Text',
}

function summarize(preset: CustomPreset): string {
  switch (preset.kind) {
    case 'regex':
      return preset.pattern ? `Pattern: ${preset.pattern}` : 'No pattern set.'
    case 'lengthRange': {
      if (preset.minLength != null && preset.maxLength != null) return `${preset.minLength}–${preset.maxLength} characters`
      if (preset.minLength != null) return `At least ${preset.minLength} characters`
      if (preset.maxLength != null) return `At most ${preset.maxLength} characters`
      return 'No length bounds set.'
    }
    case 'numericRange': {
      if (preset.minValue != null && preset.maxValue != null) return `Between ${preset.minValue} and ${preset.maxValue}`
      if (preset.minValue != null) return `At least ${preset.minValue}`
      if (preset.maxValue != null) return `At most ${preset.maxValue}`
      return 'No value bounds set.'
    }
    case 'textPattern':
      return preset.textMode ? `Character type: ${preset.textMode}` : 'No character type set.'
    default:
      return ''
  }
}

/**
 * Shows BOTH catalogs a field's "Add Validation Rule" dropdown actually offers — the fixed, code-defined
 * presets (FIELD_PRESETS, read-only here) and the admin-defined custom ones (full CRUD) — so this page
 * is the single place that matches what Manage Fields' picker shows, instead of only listing the custom
 * half and leaving the built-ins invisible anywhere but that dropdown.
 */
export function ManageFormatsPage() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const isAdministrator = Boolean(useAuthStore((s) => s.user)?.isAdministrator)
  const hasCapability = useAuthStore((s) => s.hasCapability)
  const canEdit = isAdministrator || hasCapability('host.settings.users', 'Edit')

  const [presets, setPresets] = useState<CustomPreset[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [editorState, setEditorState] = useState<{ open: boolean; preset: CustomPreset | null }>({
    open: false,
    preset: null,
  })

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const res = await customPresetsApi.get(accessToken!)
        if (cancelled) return
        setPresets(res.presets)
        setError(null)
        setDirty(false)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Could not load the format catalog.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [accessToken])

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

  async function handleSaveChanges() {
    if (!accessToken) return
    setSaving(true)
    try {
      const res = await customPresetsApi.update(accessToken, { presets })
      setPresets(res.presets)
      setDirty(false)
      toast.success('Formats updated. They now appear in the validation rule picker on any field.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save the format changes.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        icon={<Icon.Key width={22} height={22} />}
        title="Manage Formats"
        subtitle="Every format Manage Fields' validation-rule picker offers — built-in presets, and custom ones you define here."
      />

      <div className={styles.listCard}>
        <div className={styles.listHeader}>
          <h3 className={styles.listTitle}>Built-in Formats</h3>
        </div>
        <p className={styles.listSubtitle}>
          Always available on every field, grouped the same way as the rule picker. These ship with the
          platform and can&rsquo;t be edited or removed.
        </p>
        <div className={styles.builtinGroups}>
          {(['textShape', 'format', 'length'] as const).map((group) => (
            <div key={group} className={styles.builtinGroup}>
              <span className={styles.builtinGroupLabel}>{PRESET_GROUP_LABELS[group]}</span>
              <div className={styles.builtinChipRow}>
                {FIELD_PRESETS.filter((p) => p.group === group).map((p) => (
                  <span key={p.id} className={styles.builtinChip} title={p.defaultMessage}>
                    {p.label}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className={styles.listCard}>
        <div className={styles.listHeader}>
          <div>
            <h3 className={styles.listTitle}>Custom Formats</h3>
            <p className={styles.listSubtitle}>
              Create reusable formats — a text/string type, a regex, a length range, or a numeric range.
            </p>
          </div>
          {canEdit && (
            <button type="button" className={styles.createButton} onClick={() => setEditorState({ open: true, preset: null })}>
              <Icon.Plus width={16} height={16} />
              <span>Add Format</span>
            </button>
          )}
        </div>

        {error && (
          <div className={styles.errorBanner} role="alert">
            {error}
          </div>
        )}

        <div className={styles.fieldsList}>
          {loading ? (
            Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className={styles.skeletonCard}>
                <SkeletonBlock width="100%" height={54} radius="13px" />
              </div>
            ))
          ) : presets.length === 0 ? (
            <p className={styles.listSubtitle}>No custom formats yet — add one above.</p>
          ) : (
            presets.map((preset) => (
              <div key={preset.key} className={styles.fieldCard}>
                <div className={styles.fieldInfo}>
                  <div className={styles.fieldNameRow}>
                    <span className={styles.fieldName}>{preset.label}</span>
                    <span className={styles.kindBadge}>{KIND_BADGE_LABELS[preset.kind]}</span>
                  </div>
                  <span className={styles.fieldDesc}>{summarize(preset)}</span>
                </div>

                <div className={styles.fieldActions}>
                  {canEdit && (
                    <button type="button" className={styles.editBtn} onClick={() => setEditorState({ open: true, preset })} title="Edit Format">
                      <Icon.Edit width={16} height={16} />
                    </button>
                  )}
                  {canEdit && (
                    <button type="button" className={styles.deleteBtn} onClick={() => handleRemove(preset.key)} title="Remove Format">
                      <Icon.Trash width={16} height={16} />
                    </button>
                  )}
                </div>
              </div>
            ))
          )}
        </div>

        {canEdit && (
          <div className={styles.footer}>
            <span className={styles.footerText}>
              {dirty ? 'You have unsaved changes.' : 'Changes are available immediately in the validation rule picker.'}
            </span>
            <Button variant="primary" loading={saving} disabled={!dirty} onClick={handleSaveChanges}>
              Save Changes
            </Button>
          </div>
        )}
      </div>

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
