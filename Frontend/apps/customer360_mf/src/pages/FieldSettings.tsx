import React, { useEffect, useState } from 'react';
import { Settings, Eye, EyeOff, Save, RefreshCw, GripVertical, AlertCircle, CheckCircle2 } from '@omniremit/ui/icons';
import { api } from '../services/api';
import { isApprovalPending } from '../types/api';
import type { FieldConfig, FieldConfigProfileType, MaskingRule } from '../types/api';
import { Button, Checkbox, DataTable, PageHeader, Select, TableSkeleton } from '@omniremit/ui';
import styles from './FieldSettings.module.css';
import cc from '../shared/c360Common.module.css';

const MASKING_RULE_LABELS: Record<MaskingRule, string> = {
  None: 'No masking',
  HideFirstShowLast: 'Hide first, show last',
  HideLastShowFirst: 'Hide last, show first',
  HideMiddleShowFirstAndLast: 'Hide middle, show first & last',
  FullMask: 'Full mask',
};

/**
 * Admin screen for the Customer 360 field-visibility/masking config (Field Settings) — lets an
 * admin control, per API field, whether it's shown at all, its label/section/order, and — for
 * fields marked sensitive — how it's masked. Purely a UI-rendering rule: the underlying CRM data is
 * never altered by anything here, only what the detail pages choose to display from it.
 */
export default function FieldSettings() {
  const [profileType, setProfileType] = useState<FieldConfigProfileType>('Individual');
  const [fields, setFields] = useState<FieldConfig[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

  const loadFields = async (type: FieldConfigProfileType) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getFieldConfig(type);
      setFields((res.data || []).slice().sort((a, b) => a.displayOrder - b.displayOrder));
    } catch (err) {
      console.error('Failed to load field config:', err);
      setError('Could not load field settings. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadFields(profileType);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileType]);

  const updateField = (id: string, patch: Partial<FieldConfig>) => {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    setPendingMessage(null);
    try {
      const res = await api.updateFieldConfig(profileType, fields);

      if (isApprovalPending(res.data)) {
        // Nothing was actually changed — the "fieldsettings" module has a checker assigned, so this
        // submission is queued instead of applied. Leave `fields` as the admin's edited (unsaved)
        // values rather than re-fetching, since nothing on the server changed yet.
        setPendingMessage(res.data.message || 'These changes require approval before they take effect.');
        setTimeout(() => setPendingMessage(null), 5000);
        return;
      }

      setFields((res.data as FieldConfig[]).slice().sort((a, b) => a.displayOrder - b.displayOrder));
      setSavedMessage('Field settings saved.');
      setTimeout(() => setSavedMessage(null), 3000);
    } catch (err) {
      console.error('Failed to save field config:', err);
      setError('Could not save field settings. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  // Group by section for display, preserving displayOrder-driven section order — same grouping
  // logic the detail pages themselves use (DynamicProfileSection.groupBySection), applied here on
  // the full unfiltered list (including hidden fields, which an admin needs to see to re-enable).
  const sections: { section: string; fields: FieldConfig[] }[] = [];
  for (const field of fields) {
    const last = sections[sections.length - 1];
    if (last && last.section === field.section) {
      last.fields.push(field);
    } else {
      sections.push({ section: field.section, fields: [field] });
    }
  }

  return (
    <div className={styles.stack}>
      <PageHeader
        icon={<Settings size={24} />}
        title="Field Settings"
        subtitle="Control which Customer 360 fields are shown and how sensitive data is masked — changes apply immediately, nothing here touches the underlying customer data."
        actions={
          <Button
            variant="onHeader"
            onClick={handleSave}
            loading={saving}
            disabled={loading || fields.length === 0}
            leadingIcon={<Save size={15} />}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        }
      />

      {/* Profile type switch */}
      <div className={styles.profileBar}>
        {/* Segmented control. Both segments previously carried `.saveBtn` — a solid primary fill —
            so the grey track behind them was invisible and there was no way to tell which profile
            type was selected. */}
        <div className={styles.segmented} role="group" aria-label="Profile type">
          {(['Individual', 'Corporate'] as FieldConfigProfileType[]).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setProfileType(type)}
              aria-pressed={profileType === type}
              className={`${styles.segment} ${profileType === type ? styles.segmentActive : ''}`}
            >
              {type}
            </button>
          ))}
        </div>

        {savedMessage && (
          <span className={styles.row2}>
            <CheckCircle2 size={15} /> {savedMessage}
          </span>
        )}
        {pendingMessage && (
          <span className={styles.row3}>
            <AlertCircle size={15} /> {pendingMessage}
          </span>
        )}
        {error && (
          <span className={styles.row4}>
            <AlertCircle size={15} /> {error}
          </span>
        )}
      </div>

      {loading ? (
        <DataTable minWidth={880}>
            <thead>
              <tr>
                {Array.from({ length: 9 }, (_, i) => (
                  <th key={i}>&nbsp;</th>
                ))}
              </tr>
            </thead>
            <TableSkeleton rows={8} columns={9} />
          </DataTable>
      ) : (
        sections.map(({ section, fields: sectionFields }) => (
          <section className={styles.section} key={section}>
            <h2 className={styles.sectionTitle}>{section}</h2>
            <DataTable minWidth={880}>
                <thead>
                  <tr>
                    <th className={styles.box2}></th>
                    <th>System Name</th>
                    <th>Label Shown to Users</th>
                    <th className={styles.box3}>Visible</th>
                    <th className={styles.box4}>Order</th>
                    <th className={styles.box5}>Sensitive</th>
                    <th className={styles.box6}>How It’s Hidden</th>
                    <th className={styles.box7}>Characters Shown</th>
                  </tr>
                </thead>
                <tbody>
                  {sectionFields.map((field) => (
                    <tr key={field.id} className={field.visible ? undefined : styles.rowHidden}>
                      <td><GripVertical size={14} color="#cbd5e1" /></td>
                      <td>
                        <code className={cc.monoMeta}>
                          {field.apiField}
                        </code>
                      </td>
                      <td>
                        <input
                          type="text"
                          value={field.displayLabel}
                          onChange={(e) => updateField(field.id, { displayLabel: e.target.value })}
                          className={styles.labelInput}
                        />
                      </td>
                      <td className={styles.rule2}>
                        <button
                          type="button"
                          onClick={() => updateField(field.id, { visible: !field.visible })}
                          title={field.visible ? 'Visible — click to hide' : 'Hidden — click to show'}
                          className={`${styles.visibilityToggle}${field.visible ? ` ${styles.visibilityToggleOn}` : ''}`}
                        >
                          {field.visible ? <Eye size={17} /> : <EyeOff size={17} />}
                        </button>
                      </td>
                      <td>
                        <input
                          type="number"
                          value={field.displayOrder}
                          onChange={(e) => updateField(field.id, { displayOrder: Number(e.target.value) || 0 })}
                          className={styles.numberInput}
                        />
                      </td>
                      <td className={styles.rule2}>
                        <Checkbox
                          checked={field.sensitive}
                          onChange={(e) => updateField(field.id, { sensitive: e.target.checked })}
                          wrapperClassName={styles.checkboxCell}
                        />
                      </td>
                      <td>
                        <Select
                          size="sm"
                          value={field.maskingRule}
                          disabled={!field.sensitive}
                          onChange={(e) => updateField(field.id, { maskingRule: e.target.value as MaskingRule })}
                          options={(Object.keys(MASKING_RULE_LABELS) as MaskingRule[]).map((rule) => ({
                            value: rule,
                            label: MASKING_RULE_LABELS[rule],
                          }))}
                        />
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          value={field.visibleCharCount}
                          onChange={(e) => updateField(field.id, { visibleCharCount: Number(e.target.value) || 0 })}
                          disabled={!field.sensitive || field.maskingRule === 'None' || field.maskingRule === 'FullMask'}
                          className={styles.numberInput}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </DataTable>
          </section>
        ))
      )}
    </div>
  );
}
