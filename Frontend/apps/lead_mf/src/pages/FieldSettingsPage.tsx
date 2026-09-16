import React, { useEffect, useState } from 'react';
import { Settings, Save, AlertCircle, CheckCircle2, Eye, EyeOff, RefreshCw } from '@omniconnect/ui/icons';
import { Button, Checkbox, DataTable, Modal, PageHeader, Select, TableSkeleton, Tabs } from '@omniconnect/ui';
import { CUSTOM_PRESET_ID, findPreset, type CustomPreset, type ValidationRule } from '@omniconnect/ui/validation';
import { ValidationRulesEditor, describeRuleProblem } from '@omniconnect/ui/validation-editor';
import styles from './FieldSettingsPage.module.css';
import shell from '../shared/leadPage.module.css';
import { apiClient, isApprovalPending } from '../api/apiClient';
import { canManageFieldSettings } from '../api/hostBridge';
import type { LeadFieldConfig } from '../config/fieldControlRegistry';

/**
 * Lead Management's own Field Settings admin page — a separate implementation from Customer 360's
 * FieldSettings.tsx, not shared, mirroring its structure (product tabs instead of profile-type tabs,
 * section-grouped table cards, full-array PUT, pending-approval banner without refetching so unsaved
 * edits under the admin's cursor are never discarded).
 */
export /* The masking vocabulary, shared by the two Field Settings pages' Select controls. */
const MASKING_RULE_OPTIONS = [
  { value: 'None', label: 'None' },
  { value: 'HideFirstShowLast', label: 'Hide First, Show Last' },
  { value: 'HideLastShowFirst', label: 'Hide Last, Show First' },
  { value: 'HideMiddleShowFirstAndLast', label: 'Hide Middle, Show Ends' },
  { value: 'FullMask', label: 'Full Mask' },
];

/** "Email address", "Custom pattern + 1 more", or "No format" — what the Format column shows. */
export function describeFormats(rules: ValidationRule[], presets: CustomPreset[]): string {
  if (rules.length === 0) return 'No format';
  const first = rules[0];
  const name =
    first.type === CUSTOM_PRESET_ID
      ? 'Custom pattern'
      : findPreset(first.type)?.label ?? presets.find((p) => p.key === first.type)?.label ?? 'Format removed';
  return rules.length > 1 ? `${name} + ${rules.length - 1} more` : name;
}

export const FieldSettingsPage: React.FC = () => {
  const canManage = canManageFieldSettings();
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [fields, setFields] = useState<LeadFieldConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);
  const [formatPresets, setFormatPresets] = useState<CustomPreset[]>([]);
  /** The version of the settings on screen, sent with Save so two administrators cannot overwrite each other. */
  const [version, setVersion] = useState<string | null>(null);
  /** The field whose formats are being edited, with the draft rules. Applied to the page only on "Done". */
  const [editingFormats, setEditingFormats] = useState<{ field: LeadFieldConfig; rules: ValidationRule[]; problem: string | null } | null>(null);

  useEffect(() => {
    (async () => {
      setFormatPresets(await apiClient.getFormatPresets());
      const list = await apiClient.getProductsWithId();
      setProducts(list);
      if (list.length > 0) setSelectedProductId(list[0].id);
    })();
  }, []);

  useEffect(() => {
    if (!selectedProductId) return;
    void loadFields(selectedProductId);
  }, [selectedProductId]);

  async function loadFields(productId: string) {
    setLoading(true);
    setError(null);
    try {
      const { fields: data, version: loadedVersion } = await apiClient.getFieldConfigForEditing(productId);
      setFields([...data].sort((a, b) => a.displayOrder - b.displayOrder));
      setVersion(loadedVersion);
    } catch {
      setError('Could not load field settings for this product.');
    } finally {
      setLoading(false);
    }
  }

  function updateField(id: string, patch: Partial<LeadFieldConfig>) {
    setFields((prev) => prev.map((f) => (f.id === id ? { ...f, ...patch } : f)));
    setSavedMessage(null);
  }

  async function handleSave() {
    if (!selectedProductId) return;
    setSaving(true);
    setError(null);
    setSavedMessage(null);
    setPendingMessage(null);
    try {
      const res = await apiClient.updateFieldConfig(selectedProductId, fields, version);
      if (isApprovalPending(res.data)) {
        // Nothing was actually changed yet — do NOT refetch, or the admin's unsaved edits under
        // their cursor would be silently replaced by the still-old server state.
        setPendingMessage(res.data.message);
        return;
      }
      if (res.success) {
        setFields([...(res.data as LeadFieldConfig[])].sort((a, b) => a.displayOrder - b.displayOrder));
        setVersion(res.version ?? null);
        setSavedMessage('Field settings saved.');
        setTimeout(() => setSavedMessage(null), 4000);
      } else {
        setError(res.message || 'Could not save field settings.');
      }
    } catch {
      setError('Could not save field settings.');
    } finally {
      setSaving(false);
    }
  }

  const sections = Array.from(new Set(fields.map((f) => f.section)));

  return (
    <div
      className={shell.page}
    >
      {/* Hero Banner */}
      <PageHeader
        icon={<Settings size={24} />}
        title="Field Settings"
        subtitle="Configure label, visibility, requirement, editability, order, and masking per financing product."
        actions={
          <Button
            type="button"
            variant="onHeader"
            onClick={handleSave}
            disabled={!canManage || saving || loading || fields.length === 0}
            title={canManage ? undefined : 'You can view field settings but not change them.'}
            loading={saving}
            leadingIcon={<Save size={15} />}
          >
            {saving ? 'Saving…' : 'Save Changes'}
          </Button>
        }
      />

      {/* Product Tabs */}
      {/* Shared Tabs: role="tablist" with roving tabindex and Left/Right/Home/End keys, none of
          which the hand-rolled button row had. */}
      <Tabs
        id="lead-field-settings-product"
        tabs={products.map((p) => ({ key: p.id, label: p.name }))}
        activeKey={selectedProductId ?? ''}
        onChange={setSelectedProductId}
      />

      {savedMessage && (
        <div className={`${styles.banner} ${styles.bannerSuccess}`}>
          <CheckCircle2 size={16} />
          <span>{savedMessage}</span>
        </div>
      )}
      {pendingMessage && (
        <div className={`${styles.banner} ${styles.bannerPending}`}>
          <AlertCircle size={16} />
          <span>{pendingMessage}</span>
        </div>
      )}
      {error && (
        <div className={`${styles.banner} ${styles.bannerError}`}>
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <DataTable bare minWidth={820}>
            <thead>
              <tr>
                {Array.from({ length: 10 }, (_, i) => (
                  <th key={i}>&nbsp;</th>
                ))}
              </tr>
            </thead>
            <TableSkeleton rows={8} columns={10} />
          </DataTable>
      ) : (
        sections.map((section) => (
          <div
            key={section}
            className={styles.sectionCard}
          >
            <div className={styles.sectionTitle}>
              {section}
            </div>
              <DataTable minWidth={820} bare>
                <thead>
                  <tr>
                    {['Field', 'Label', 'Order', 'Visible', 'Required', 'Editable', 'Format', 'Sensitive', 'Masking Rule', 'Visible Chars'].map((h) => (
                      <th key={h}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fields
                    .filter((f) => f.section === section)
                    .map((f) => (
                      <tr key={f.id} className={f.visible ? undefined : styles.rowHidden}>
                        <td className={styles.cell}>
                          <code className={styles.apiField}>{f.apiField}</code>
                        </td>
                        <td className={styles.cell}>
                          <input
                            type="text"
                            value={f.displayLabel}
                            onChange={(e) => updateField(f.id, { displayLabel: e.target.value })}
                            className={styles.labelInput}
                          />
                        </td>
                        <td className={styles.cell}>
                          <input
                            type="number"
                            value={f.displayOrder}
                            onChange={(e) => updateField(f.id, { displayOrder: Number(e.target.value) })}
                            className={styles.orderInput}
                          />
                        </td>
                        <td className={styles.cell}>
                          <button
                            type="button"
                            onClick={() => updateField(f.id, { visible: !f.visible })}
                            className={`${styles.visibilityToggle}${f.visible ? ` ${styles.visibilityToggleOn}` : ''}`}
                            aria-label={f.visible ? 'Hide field' : 'Show field'}
                          >
                            {f.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                          </button>
                        </td>
                        <td className={styles.cell}>
                          <Checkbox
                            checked={f.required}
                            onChange={(e) => updateField(f.id, { required: e.target.checked })}
                            wrapperClassName={styles.checkboxCell}
                          />
                        </td>
                        <td className={styles.cell}>
                          <Checkbox
                            checked={f.editable}
                            onChange={(e) => updateField(f.id, { editable: e.target.checked })}
                            wrapperClassName={styles.checkboxCell}
                          />
                        </td>
                        <td className={styles.cell}>
                          <button
                            type="button"
                            className={styles.formatButton}
                            onClick={() => setEditingFormats({ field: f, rules: f.validations ?? [], problem: null })}
                            aria-label={`Formats for `}
                          >
                            {describeFormats(f.validations ?? [], formatPresets)}
                          </button>
                        </td>
                        <td className={styles.cell}>
                          <Checkbox
                            checked={f.sensitive}
                            onChange={(e) =>
                              updateField(f.id, {
                                sensitive: e.target.checked,
                                maskingRule: e.target.checked ? (f.maskingRule === 'None' ? 'HideFirstShowLast' : f.maskingRule) : 'None',
                              })
                            }
                            wrapperClassName={styles.checkboxCell}
                          />
                        </td>
                        <td className={styles.cell}>
                          <Select
                            size="sm"
                            value={f.maskingRule}
                            disabled={!f.sensitive}
                            onChange={(e) => updateField(f.id, { maskingRule: e.target.value as LeadFieldConfig['maskingRule'] })}
                            options={MASKING_RULE_OPTIONS}
                          />
                        </td>
                        <td className={styles.cell}>
                          <input
                            type="number"
                            min={0}
                            value={f.visibleCharCount}
                            disabled={!f.sensitive || f.maskingRule === 'None' || f.maskingRule === 'FullMask'}
                            onChange={(e) => updateField(f.id, { visibleCharCount: Number(e.target.value) })}
                            className={styles.numberInput}
                          />
                        </td>
                      </tr>
                    ))}
                </tbody>
              </DataTable>
          </div>
        ))
      )}

      <Modal
        open={editingFormats !== null}
        title={editingFormats ? `Formats for ` : ''}
        onClose={() => setEditingFormats(null)}
        actions={
          <>
            <Button variant="secondary" onClick={() => setEditingFormats(null)}>Cancel</Button>
            <Button
              disabled={!canManage}
              onClick={() => {
                if (!editingFormats) return;
                const problem = describeRuleProblem(editingFormats.rules);
                if (problem) {
                  setEditingFormats({ ...editingFormats, problem });
                  return;
                }
                updateField(editingFormats.field.id, { validations: editingFormats.rules });
                setEditingFormats(null);
              }}
            >
              Done
            </Button>
          </>
        }
      >
        {editingFormats && (
          <div className={styles.formatEditor}>
            <p className={styles.formatIntro}>
              A value entered for this field must meet every format below. Changes take effect when you save the field settings.
            </p>
            {editingFormats.problem && <div role="alert" className={`${styles.banner} ${styles.bannerError}`}>{editingFormats.problem}</div>}
            <ValidationRulesEditor
              rules={editingFormats.rules}
              customPresets={formatPresets}
              onChange={(rules) => setEditingFormats({ ...editingFormats, rules, problem: null })}
            />
          </div>
        )}
      </Modal>
    </div>
  );
};
