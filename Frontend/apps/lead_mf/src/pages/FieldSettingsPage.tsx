import React, { useEffect, useState } from 'react';
import { Settings, Save, AlertCircle, CheckCircle2, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { Button, Checkbox, DataTable, PageHeader, Select, Tabs } from '@omniremit/ui';
import styles from './FieldSettingsPage.module.css';
import shell from '../shared/leadPage.module.css';
import { apiClient, isApprovalPending } from '../api/apiClient';
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

export const FieldSettingsPage: React.FC = () => {
  const [products, setProducts] = useState<{ id: string; name: string }[]>([]);
  const [selectedProductId, setSelectedProductId] = useState<string>('');
  const [fields, setFields] = useState<LeadFieldConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedMessage, setSavedMessage] = useState<string | null>(null);
  const [pendingMessage, setPendingMessage] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
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
      const data = await apiClient.getFieldConfig(productId);
      setFields([...data].sort((a, b) => a.displayOrder - b.displayOrder));
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
      const res = await apiClient.updateFieldConfig(selectedProductId, fields);
      if (isApprovalPending(res.data)) {
        // Nothing was actually changed yet — do NOT refetch, or the admin's unsaved edits under
        // their cursor would be silently replaced by the still-old server state.
        setPendingMessage(res.data.message);
        return;
      }
      if (res.success) {
        setFields([...(res.data as LeadFieldConfig[])].sort((a, b) => a.displayOrder - b.displayOrder));
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
            disabled={saving || loading || fields.length === 0}
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
        <div className={styles.loading}>
          <RefreshCw size={18} className={`animate-spin ${styles.loadingSpinner}`} />
          <div className={styles.loadingText}>Loading field settings…</div>
        </div>
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
                    {['Field', 'Label', 'Order', 'Visible', 'Required', 'Editable', 'Sensitive', 'Masking Rule', 'Visible Chars'].map((h) => (
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
    </div>
  );
};
