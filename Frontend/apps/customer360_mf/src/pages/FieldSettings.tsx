import React, { useEffect, useState } from 'react';
import { Settings, Eye, EyeOff, Save, RefreshCw, GripVertical, AlertCircle, CheckCircle2 } from 'lucide-react';
import { api } from '../services/api';
import { isApprovalPending } from '../types/api';
import type { FieldConfig, FieldConfigProfileType, MaskingRule } from '../types/api';
import { C360FieldSettingsSkeleton } from '../components/common/PageSkeletons';

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
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Hero Banner — same host-matching treatment as the rest of this app's pages */}
      <div className="c360-hero-banner">
        <div style={{ position: 'absolute', top: '-50px', right: '-50px', width: '220px', height: '220px', borderRadius: '50%', background: 'rgba(255, 255, 255, 0.07)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: '-60px', right: '120px', width: '160px', height: '160px', borderRadius: '50%', background: 'rgba(255, 255, 255, 0.05)', pointerEvents: 'none' }} />
        <div className="c360-hero-left">
          <div style={{ width: '50px', height: '50px', borderRadius: '14px', background: 'rgba(255, 255, 255, 0.18)', border: '1.5px solid rgba(255, 255, 255, 0.3)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#ffffff', flexShrink: 0 }}>
            <Settings size={24} />
          </div>
          <div>
            <h1 className="c360-hero-title">Field Settings</h1>
            <p className="c360-hero-subtitle">
              Control which Customer 360 fields are shown and how sensitive data is masked — changes apply immediately, nothing here touches the underlying customer data.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={handleSave}
          disabled={saving || loading || fields.length === 0}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: '7px', height: '40px', padding: '0 18px',
            borderRadius: '12px', border: '1px solid rgba(255, 255, 255, 0.35)', background: 'rgba(255, 255, 255, 0.95)',
            color: '#1d4ed8', fontSize: '13.5px', fontWeight: 700,
            cursor: saving || loading ? 'not-allowed' : 'pointer', opacity: saving || loading ? 0.6 : 1,
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.12)', fontFamily: 'inherit', flexShrink: 0, position: 'relative', zIndex: 1,
          }}
        >
          {saving ? <RefreshCw size={15} className="c360-spinner" /> : <Save size={15} />}
          <span>{saving ? 'Saving…' : 'Save Changes'}</span>
        </button>
      </div>

      {/* Profile type switch */}
      <div className="c360-search-panel" style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <div style={{ display: 'inline-flex', gap: '8px', background: '#f1f5f9', padding: '4px', borderRadius: '10px' }}>
          {(['Individual', 'Corporate'] as FieldConfigProfileType[]).map((type) => (
            <button
              key={type}
              type="button"
              onClick={() => setProfileType(type)}
              style={{
                padding: '8px 18px', borderRadius: '8px', border: 'none', fontSize: '13px', fontWeight: 600,
                cursor: 'pointer', transition: 'all 0.15s ease',
                background: profileType === type ? '#ffffff' : 'transparent',
                color: profileType === type ? '#1d4ed8' : '#64748b',
                boxShadow: profileType === type ? '0 1px 3px rgba(15,23,42,0.08)' : 'none',
              }}
            >
              {type}
            </button>
          ))}
        </div>

        {savedMessage && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#16a34a', fontSize: '13px', fontWeight: 600 }}>
            <CheckCircle2 size={15} /> {savedMessage}
          </span>
        )}
        {pendingMessage && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#b45309', fontSize: '13px', fontWeight: 600 }}>
            <AlertCircle size={15} /> {pendingMessage}
          </span>
        )}
        {error && (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#dc2626', fontSize: '13px', fontWeight: 600 }}>
            <AlertCircle size={15} /> {error}
          </span>
        )}
      </div>

      {loading ? (
        <C360FieldSettingsSkeleton />
      ) : (
        sections.map(({ section, fields: sectionFields }) => (
          <div className="c360-table-container" key={section}>
            <div style={{ padding: '14px 20px', borderBottom: '1px solid #eaecf0', fontWeight: 700, fontSize: '13.5px', color: '#0f172a' }}>
              {section}
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table className="c360-table">
                <thead>
                  <tr>
                    <th style={{ width: '32px' }}></th>
                    <th>API Field</th>
                    <th>Display Label</th>
                    <th style={{ width: '90px', textAlign: 'center' }}>Visible</th>
                    <th style={{ width: '90px' }}>Order</th>
                    <th style={{ width: '100px', textAlign: 'center' }}>Sensitive</th>
                    <th style={{ width: '260px' }}>Masking Rule</th>
                    <th style={{ width: '110px' }}>Visible Chars</th>
                  </tr>
                </thead>
                <tbody>
                  {sectionFields.map((field) => (
                    <tr key={field.id} style={field.visible ? undefined : { opacity: 0.5 }}>
                      <td><GripVertical size={14} color="#cbd5e1" /></td>
                      <td>
                        <code style={{ fontSize: '11.5px', color: '#64748b', fontFamily: "'SF Mono', 'Fira Code', monospace" }}>
                          {field.apiField}
                        </code>
                      </td>
                      <td>
                        <input
                          type="text"
                          value={field.displayLabel}
                          onChange={(e) => updateField(field.id, { displayLabel: e.target.value })}
                          className="c360-input no-icon"
                          style={{ height: '34px', fontSize: '13px', width: '100%', minWidth: '180px' }}
                        />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <button
                          type="button"
                          onClick={() => updateField(field.id, { visible: !field.visible })}
                          title={field.visible ? 'Visible — click to hide' : 'Hidden — click to show'}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', color: field.visible ? '#2563eb' : '#94a3b8', display: 'inline-flex' }}
                        >
                          {field.visible ? <Eye size={17} /> : <EyeOff size={17} />}
                        </button>
                      </td>
                      <td>
                        <input
                          type="number"
                          value={field.displayOrder}
                          onChange={(e) => updateField(field.id, { displayOrder: Number(e.target.value) || 0 })}
                          className="c360-input no-icon"
                          style={{ height: '34px', fontSize: '13px', width: '70px' }}
                        />
                      </td>
                      <td style={{ textAlign: 'center' }}>
                        <input
                          type="checkbox"
                          checked={field.sensitive}
                          onChange={(e) => updateField(field.id, { sensitive: e.target.checked })}
                          style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                        />
                      </td>
                      <td>
                        <select
                          value={field.maskingRule}
                          onChange={(e) => updateField(field.id, { maskingRule: e.target.value as MaskingRule })}
                          disabled={!field.sensitive}
                          className="c360-select"
                          style={{ height: '34px', fontSize: '12.5px', width: '100%' }}
                        >
                          {(Object.keys(MASKING_RULE_LABELS) as MaskingRule[]).map((rule) => (
                            <option key={rule} value={rule}>{MASKING_RULE_LABELS[rule]}</option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <input
                          type="number"
                          min={0}
                          value={field.visibleCharCount}
                          onChange={(e) => updateField(field.id, { visibleCharCount: Number(e.target.value) || 0 })}
                          disabled={!field.sensitive || field.maskingRule === 'None' || field.maskingRule === 'FullMask'}
                          className="c360-input no-icon"
                          style={{ height: '34px', fontSize: '13px', width: '70px' }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
    </div>
  );
}
