import { useEffect, useState } from 'react'
import { useAuthStore } from '../../auth/store/authStore'
import { userSchemaApi } from '../api/userSchemaApi'
import { customPresetsApi } from '../api/customPresetsApi'
import { FieldEditorModal } from '../components/FieldEditorModal'
import { SalutationsCard } from '../components/SalutationsCard'
import { Icon } from '../../../shared/components/Icon/Icon'
import { SkeletonBlock } from '../../../shared/components/Skeleton'
import { ApiError } from '../../../shared/api/httpClient'
import { toast } from '../../../shared/stores/toastStore'
import { Button, PageHeader } from '@omniremit/ui'
import type { CustomPreset, FieldDefinition } from '@omniremit/ui/validation'
import styles from './ManageFieldsPage.module.css'

export function ManageFieldsPage() {
  const accessToken = useAuthStore((s) => s.accessToken)
  const isAdministrator = Boolean(useAuthStore((s) => s.user)?.isAdministrator)
  const hasCapability = useAuthStore((s) => s.hasCapability)
  const canEdit = isAdministrator || hasCapability('host.settings.users', 'Edit')

  const [fields, setFields] = useState<FieldDefinition[]>([])
  const [customPresets, setCustomPresets] = useState<CustomPreset[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [dirty, setDirty] = useState(false)
  const [editorState, setEditorState] = useState<{ open: boolean; field: FieldDefinition | null }>({
    open: false,
    field: null,
  })

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false

    async function load() {
      setLoading(true)
      try {
        const [schemaRes, presetsRes] = await Promise.all([
          userSchemaApi.get(accessToken!),
          customPresetsApi.get(accessToken!),
        ])
        if (cancelled) return
        setFields([...schemaRes.fields].sort((a, b) => a.order - b.order))
        setVersion(schemaRes.version)
        setCustomPresets(presetsRes.presets)
        setError(null)
        setDirty(false)
      } catch (err) {
        if (cancelled) return
        setError(err instanceof ApiError ? err.message : 'Could not load the user field schema.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [accessToken])

  function withOrder(list: FieldDefinition[]): FieldDefinition[] {
    return list.map((f, i) => ({ ...f, order: i + 1 }))
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

  // The schema version this page is editing — sent with the save so two administrators cannot overwrite each other.
  const [version, setVersion] = useState<number | undefined>(undefined)

  async function handleSaveChanges() {
    if (!accessToken) return
    setSaving(true)
    try {
      const res = await userSchemaApi.update(accessToken, { fields, expectedVersion: version })
      setFields([...res.fields].sort((a, b) => a.order - b.order))
      setVersion(res.version)
      setDirty(false)
      toast.success('User fields updated. The Create/Edit User form now reflects these changes.')
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'Could not save the field changes.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={styles.page}>
      <PageHeader
        icon={<Icon.FileText width={22} height={22} />}
        title="Manage Fields"
        subtitle="Choose which fields appear on the Create/Edit User form and how each one is validated."
      />

      <SalutationsCard canEdit={canEdit} />

      <div className={styles.listCard}>
        <div className={styles.listHeader}>
          <div>
            <h3 className={styles.listTitle}>Fields</h3>
            <p className={styles.listSubtitle}>Name, Email and Mobile are core and can&rsquo;t be removed; add as many custom fields as you need.</p>
          </div>
          {canEdit && (
            <button type="button" className={styles.createButton} onClick={() => setEditorState({ open: true, field: null })}>
              <Icon.Plus width={16} height={16} />
              <span>Add Field</span>
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
            Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className={styles.skeletonCard}>
                <SkeletonBlock width="100%" height={54} radius="13px" />
              </div>
            ))
          ) : (
            fields.map((field) => (
              <div key={field.key} className={styles.fieldCard}>
                <div className={styles.fieldInfo}>
                  <div className={styles.fieldNameRow}>
                    <span className={styles.fieldName}>{field.label}</span>
                    {field.core && (
                      <span className={styles.coreBadge}>
                        <Icon.Lock width={10} height={10} /> Core
                      </span>
                    )}
                    {field.required && <span className={styles.requiredBadge}>Required</span>}
                  </div>
                  <span className={styles.fieldDesc}>
                    {field.validations.length === 0
                      ? 'No extra validation — any value is accepted.'
                      : field.validations.map((v) => v.message).join(' · ')}
                  </span>
                </div>

                <div className={styles.fieldActions}>
                  {canEdit && (
                    <button type="button" className={styles.editBtn} onClick={() => setEditorState({ open: true, field })} title="Edit Field">
                      <Icon.Edit width={16} height={16} />
                    </button>
                  )}
                  {canEdit && !field.core && (
                    <button type="button" className={styles.deleteBtn} onClick={() => handleRemove(field.key)} title="Remove Field">
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
              {dirty ? 'You have unsaved changes.' : 'Changes take effect the next time someone opens Create User.'}
            </span>
            <Button variant="primary" loading={saving} disabled={!dirty} onClick={handleSaveChanges}>
              Save Changes
            </Button>
          </div>
        )}
      </div>

      <FieldEditorModal
        open={editorState.open}
        field={editorState.field}
        existingKeys={fields.map((f) => f.key)}
        customPresets={customPresets}
        onSave={handleSaveField}
        onClose={() => setEditorState({ open: false, field: null })}
      />
    </div>
  )
}
