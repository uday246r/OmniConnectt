import React, { useEffect, useState } from 'react';
import { Settings, Save, AlertCircle, CheckCircle2, Eye, EyeOff, RefreshCw } from 'lucide-react';
import { apiClient, isApprovalPending } from '../api/apiClient';
import type { LeadFieldConfig } from '../config/fieldControlRegistry';
import { FieldSettingsSkeleton } from '../components/common/PageSkeletons';

/**
 * Lead Management's own Field Settings admin page — a separate implementation from Customer 360's
 * FieldSettings.tsx, not shared, mirroring its structure (product tabs instead of profile-type tabs,
 * section-grouped table cards, full-array PUT, pending-approval banner without refetching so unsaved
 * edits under the admin's cursor are never discarded).
 */
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
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '20px',
        maxWidth: '1340px',
        width: '100%',
        paddingBottom: '32px',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        boxSizing: 'border-box',
      }}
    >
      {/* Hero Banner */}
      <div
        className="lead-hero-banner"
        style={{
          borderRadius: '18px',
          padding: '24px 30px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '20px',
          flexWrap: 'wrap',
          position: 'relative',
          overflow: 'hidden',
          background: 'linear-gradient(120deg, #1e40af 0%, #2563eb 45%, #3b82f6 100%)',
          boxShadow: '0 4px 20px rgba(37, 99, 235, 0.25), 0 1px 4px rgba(37, 99, 235, 0.15)',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '18px', minWidth: 0, position: 'relative', zIndex: 1 }}>
          <div
            style={{
              width: '50px',
              height: '50px',
              borderRadius: '14px',
              background: 'rgba(255, 255, 255, 0.18)',
              border: '1.5px solid rgba(255, 255, 255, 0.3)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              flexShrink: 0,
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
            }}
          >
            <Settings size={24} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <h1 style={{ fontSize: '20px', fontWeight: 800, color: '#ffffff', margin: 0, letterSpacing: '-0.025em' }}>
              Field Settings
            </h1>
            <p style={{ fontSize: '13px', color: 'rgba(255, 255, 255, 0.85)', margin: 0 }}>
              Configure label, visibility, requirement, editability, order, and masking per financing product.
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleSave}
          disabled={saving || loading || fields.length === 0}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '7px',
            height: '40px',
            padding: '0 18px',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.35)',
            background: 'rgba(255, 255, 255, 0.95)',
            color: '#1d4ed8',
            fontSize: '13.5px',
            fontWeight: 700,
            cursor: saving || loading || fields.length === 0 ? 'not-allowed' : 'pointer',
            opacity: saving || loading || fields.length === 0 ? 0.6 : 1,
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.12)',
            fontFamily: 'inherit',
            flexShrink: 0,
          }}
        >
          {saving ? <RefreshCw size={15} className="animate-spin" /> : <Save size={15} />}
          <span>{saving ? 'Saving…' : 'Save Changes'}</span>
        </button>
      </div>

      {/* Product Tabs */}
      <div style={{ display: 'inline-flex', gap: '4px', background: '#f1f5f9', padding: '4px', borderRadius: '10px', width: 'fit-content', flexWrap: 'wrap' }}>
        {products.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setSelectedProductId(p.id)}
            style={{
              padding: '8px 16px',
              borderRadius: '7px',
              border: 'none',
              fontSize: '12.5px',
              fontWeight: 600,
              cursor: 'pointer',
              fontFamily: 'inherit',
              background: selectedProductId === p.id ? '#ffffff' : 'transparent',
              color: selectedProductId === p.id ? '#2563eb' : '#64748b',
              boxShadow: selectedProductId === p.id ? '0 1px 3px rgba(15, 23, 42, 0.08)' : 'none',
            }}
          >
            {p.name}
          </button>
        ))}
      </div>

      {savedMessage && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: '10px', background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#047857', fontSize: '13px', fontWeight: 600 }}>
          <CheckCircle2 size={16} />
          <span>{savedMessage}</span>
        </div>
      )}
      {pendingMessage && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: '10px', background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', fontSize: '13px', fontWeight: 600 }}>
          <AlertCircle size={16} />
          <span>{pendingMessage}</span>
        </div>
      )}
      {error && (
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '10px 16px', borderRadius: '10px', background: '#fef2f2', border: '1px solid #fecaca', color: '#dc2626', fontSize: '13px', fontWeight: 600 }}>
          <AlertCircle size={16} />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <FieldSettingsSkeleton />
      ) : (
        sections.map((section) => (
          <div
            key={section}
            style={{
              background: '#ffffff',
              borderRadius: '16px',
              border: '1px solid #eaecf0',
              boxShadow: '0 1px 4px rgba(15, 23, 42, 0.04)',
              overflow: 'hidden',
            }}
          >
            <div style={{ padding: '13px 20px', borderBottom: '1px solid #eaecf0', background: '#f8fafc', fontSize: '13px', fontWeight: 700, color: '#0f172a' }}>
              {section}
            </div>
            <div style={{ overflowX: 'auto', WebkitOverflowScrolling: 'touch' }}>
              <table style={{ width: '100%', minWidth: '820px', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
                <thead>
                  <tr style={{ background: '#ffffff', borderBottom: '1px solid #eaecf0' }}>
                    {['Field', 'Label', 'Order', 'Visible', 'Required', 'Editable', 'Sensitive', 'Masking Rule', 'Visible Chars'].map((h) => (
                      <th key={h} style={{ padding: '10px 16px', fontWeight: 700, fontSize: '10.5px', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b', whiteSpace: 'nowrap' }}>
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {fields
                    .filter((f) => f.section === section)
                    .map((f) => (
                      <tr key={f.id} style={{ borderBottom: '1px solid #f1f5f9', opacity: f.visible ? 1 : 0.55 }}>
                        <td style={{ padding: '10px 16px' }}>
                          <code style={{ fontSize: '12px', color: '#64748b' }}>{f.apiField}</code>
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <input
                            type="text"
                            value={f.displayLabel}
                            onChange={(e) => updateField(f.id, { displayLabel: e.target.value })}
                            style={{ width: '180px', padding: '6px 10px', borderRadius: '7px', border: '1px solid #cbd5e1', fontSize: '13px', fontFamily: 'inherit' }}
                          />
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <input
                            type="number"
                            value={f.displayOrder}
                            onChange={(e) => updateField(f.id, { displayOrder: Number(e.target.value) })}
                            style={{ width: '64px', padding: '6px 8px', borderRadius: '7px', border: '1px solid #cbd5e1', fontSize: '13px', fontFamily: 'inherit' }}
                          />
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <button
                            type="button"
                            onClick={() => updateField(f.id, { visible: !f.visible })}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: f.visible ? '#2563eb' : '#94a3b8', display: 'flex' }}
                            aria-label={f.visible ? 'Hide field' : 'Show field'}
                          >
                            {f.visible ? <Eye size={16} /> : <EyeOff size={16} />}
                          </button>
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <input
                            type="checkbox"
                            checked={f.required}
                            onChange={(e) => updateField(f.id, { required: e.target.checked })}
                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                          />
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <input
                            type="checkbox"
                            checked={f.editable}
                            onChange={(e) => updateField(f.id, { editable: e.target.checked })}
                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                          />
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <input
                            type="checkbox"
                            checked={f.sensitive}
                            onChange={(e) =>
                              updateField(f.id, {
                                sensitive: e.target.checked,
                                maskingRule: e.target.checked ? (f.maskingRule === 'None' ? 'HideFirstShowLast' : f.maskingRule) : 'None',
                              })
                            }
                            style={{ width: '16px', height: '16px', cursor: 'pointer' }}
                          />
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <select
                            value={f.maskingRule}
                            disabled={!f.sensitive}
                            onChange={(e) => updateField(f.id, { maskingRule: e.target.value as LeadFieldConfig['maskingRule'] })}
                            style={{ padding: '6px 8px', borderRadius: '7px', border: '1px solid #cbd5e1', fontSize: '12.5px', fontFamily: 'inherit', opacity: f.sensitive ? 1 : 0.5 }}
                          >
                            <option value="None">None</option>
                            <option value="HideFirstShowLast">Hide First, Show Last</option>
                            <option value="HideLastShowFirst">Hide Last, Show First</option>
                            <option value="HideMiddleShowFirstAndLast">Hide Middle, Show Ends</option>
                            <option value="FullMask">Full Mask</option>
                          </select>
                        </td>
                        <td style={{ padding: '10px 16px' }}>
                          <input
                            type="number"
                            min={0}
                            value={f.visibleCharCount}
                            disabled={!f.sensitive || f.maskingRule === 'None' || f.maskingRule === 'FullMask'}
                            onChange={(e) => updateField(f.id, { visibleCharCount: Number(e.target.value) })}
                            style={{
                              width: '56px',
                              padding: '6px 8px',
                              borderRadius: '7px',
                              border: '1px solid #cbd5e1',
                              fontSize: '13px',
                              fontFamily: 'inherit',
                              opacity: !f.sensitive || f.maskingRule === 'None' || f.maskingRule === 'FullMask' ? 0.5 : 1,
                            }}
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
};
