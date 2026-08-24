import React, { useEffect, useState } from 'react';
import {
  X,
  User,
  Package,
  Briefcase,
  UserCheck,
  FileText,
  CheckCircle2,
  Eye,
  EyeOff,
  Phone,
  Mail,
  Key,
  Building2,
  Building,
  MapPin,
  CreditCard,
  Calendar,
  Home,
  Layers,
  Copy,
  Check,
  Clock,
  Shield,
  Hash,
  Sparkles,
} from 'lucide-react';
import { useLeadStore } from '../../store/useLeadStore';
import { isFieldVisible, getFieldLabel, type LeadFieldConfig } from '../../config/fieldControlRegistry';
import { applyMaskingRule, hasRevealableValue } from '../../utils/fieldMasking';

const formatVal = (val?: string | null): string => {
  if (!val || !val.trim() || val.trim().toLowerCase() === 'null' || val.trim().toLowerCase() === 'undefined') {
    return '—';
  }
  return val.trim();
};

/*
 * Applied financing is delivered as a free-text string, so it can arrive as "50,000", "RM 50,000",
 * "N/A", or empty. The previous inline expression did Number(val.replace(/,/g, '')).toLocaleString()
 * and rendered the literal "RM NaN" for every one of those non-numeric forms — the amount looked
 * broken rather than absent.
 *
 * Strips grouping separators and any currency prefix, then renders only when the result is a real
 * finite number; anything else falls back to the same em dash the other formatters use.
 */
const formatRinggit = (val?: string | null): string => {
  if (!val || !val.trim()) return '—';
  // Guarded against the empty string specifically: Number('') is 0, not NaN, so a purely
  // non-numeric value like "N/A" would otherwise strip to '' and render a confident "RM 0".
  const cleaned = val.replace(/[^0-9.-]/g, '');
  if (!cleaned) return '—';
  const numeric = Number(cleaned);
  if (!Number.isFinite(numeric)) return '—';
  return `RM ${numeric.toLocaleString('en-MY', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
};

const formatConsent = (val?: string | null): string => {
  if (!val || !val.trim()) return '—';
  const v = val.trim().toUpperCase();
  if (v === 'CONSENT') return 'Consented to marketing & promotional activities';
  if (v === 'DO_NOT_CONSENT') return 'Did not consent to marketing & promotional activities';
  return val;
};

const getInitials = (name: string): string => {
  const parts = (name || '').split(' ').filter((p) => !['bin', 'binti', 'a/l', 'a/p'].includes(p.toLowerCase()));
  if (parts.length >= 2) {
    return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  }
  return parts[0]?.substring(0, 2).toUpperCase() || '??';
};

const getStatusBadge = (status?: string) => {
  const s = status?.toLowerCase() || 'new';
  if (s.includes('convert')) {
    return { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0', dot: '#10b981', label: status || 'Converted' };
  }
  if (s.includes('progress')) {
    return { bg: '#fffbeb', text: '#b45309', border: '#fde68a', dot: '#f59e0b', label: status || 'In Progress' };
  }
  if (s.includes('reject') || s.includes('cancel')) {
    return { bg: '#fff1f2', text: '#be185d', border: '#fecdd3', dot: '#f43f5e', label: status || 'Rejected' };
  }
  if (s.includes('qualif') || s.includes('contact')) {
    return { bg: '#ede9fe', text: '#6d28d9', border: '#ddd6fe', dot: '#8b5cf6', label: status || 'Contacted' };
  }
  return { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe', dot: '#2563eb', label: status || 'New' };
};

export const LeadDetailsDrawer: React.FC = () => {
  const { selectedLead, isDetailsDrawerOpen, closeDetailsDrawer, fieldConfig } = useLeadStore();
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  function toggleReveal(apiField: string) {
    setRevealed((prev) => ({ ...prev, [apiField]: !prev[apiField] }));
  }

  function handleCopyText(key: string, text?: string | null) {
    if (!text || text === '—') return;
    navigator.clipboard.writeText(text);
    setCopiedField(key);
    setTimeout(() => setCopiedField(null), 1500);
  }

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (isDetailsDrawerOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isDetailsDrawerOpen]);

  if (!isDetailsDrawerOpen || !selectedLead) return null;

  const leadIdStr = selectedLead.id ? String(selectedLead.id) : '';
  const initials = getInitials(selectedLead.name);
  const statusInfo = getStatusBadge(selectedLead.status);

  const isHomeFinancing =
    fieldConfig.some((f) => f.apiField === 'propertyType') ||
    !!selectedLead.propertyType ||
    !!selectedLead.propertyStatus;
  const isMicrofinance =
    fieldConfig.some((f) => f.apiField === 'dateOfIncorporation') ||
    !!selectedLead.companyName ||
    !!selectedLead.entityType ||
    !!selectedLead.dateOfIncorporation;

  const handleCopyId = () => {
    if (!leadIdStr) return;
    navigator.clipboard.writeText(leadIdStr);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 1600);
  };

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      closeDetailsDrawer();
    }
  };

  /** Field-card component with icon, label, masked/plain value, and quick actions */
  function FieldCard({
    apiField,
    label,
    raw,
    icon: IconComponent,
    iconTone = 'primary',
    fullWidth = false,
    copyable = false,
    valueStyle,
  }: {
    apiField: string;
    label: string;
    raw?: string | null;
    icon: React.ComponentType<{ size: number }>;
    iconTone?: 'primary' | 'neutral' | 'purple' | 'success' | 'amber';
    fullWidth?: boolean;
    copyable?: boolean;
    valueStyle?: React.CSSProperties;
  }) {
    if (!isFieldVisible(fieldConfig, apiField)) return null;

    const entry = fieldConfig.find((f) => f.apiField === apiField) as LeadFieldConfig | undefined;
    const formatted = formatVal(raw);
    const canReveal = !!entry?.sensitive && hasRevealableValue(raw) && formatted !== '—';
    const displayValue =
      canReveal && !revealed[apiField]
        ? applyMaskingRule(formatted, entry!.maskingRule, entry!.visibleCharCount)
        : formatted;

    const iconClass =
      iconTone === 'neutral'
        ? 'lead-field-icon lead-field-icon-neutral'
        : iconTone === 'purple'
        ? 'lead-field-icon lead-field-icon-purple'
        : iconTone === 'success'
        ? 'lead-field-icon lead-field-icon-success'
        : iconTone === 'amber'
        ? 'lead-field-icon lead-field-icon-amber'
        : 'lead-field-icon';

    const isCopied = copiedField === apiField;

    return (
      <div className={`lead-field-card ${fullWidth ? 'lead-field-card-full' : ''}`}>
        <span className={iconClass}>
          <IconComponent size={15} />
        </span>
        <div className="lead-field-body">
          <span className="lead-field-label">{getFieldLabel(fieldConfig, apiField, label)}</span>
          <div
            className="lead-field-value"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '6px',
              ...valueStyle,
            }}
          >
            <span style={{ overflowWrap: 'anywhere' }}>{displayValue}</span>
            <div style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', flexShrink: 0 }}>
              {canReveal && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleReveal(apiField);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '2px',
                    borderRadius: '4px',
                    transition: 'color 0.12s ease',
                  }}
                  aria-label={revealed[apiField] ? 'Hide value' : 'Reveal value'}
                  title={revealed[apiField] ? 'Hide value' : 'Reveal sensitive value'}
                >
                  {revealed[apiField] ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              )}
              {copyable && formatted !== '—' && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    handleCopyText(apiField, raw);
                  }}
                  style={{
                    background: 'none',
                    border: 'none',
                    cursor: 'pointer',
                    color: isCopied ? '#059669' : '#94a3b8',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '2px',
                    borderRadius: '4px',
                    transition: 'color 0.12s ease',
                  }}
                  title="Copy value"
                >
                  {isCopied ? <Check size={12} /> : <Copy size={12} />}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="drawer-overlay" style={{ zIndex: 1200 }} onClick={handleOverlayClick}>
      <div className="lead-details-drawer" onClick={(e) => e.stopPropagation()}>
        {/* Radiant Gradient Header — Exact Host Aesthetic */}
        <div className="audit-drawer-header">
          <div className="audit-drawer-header::before" />
          <div className="audit-header-glow" />
          <div className="audit-header-left">
            <div className="audit-header-icon-box">
              <Shield size={22} />
            </div>
            <div className="audit-header-text">
              <h2 className="audit-header-title">Lead Record Details</h2>
              <p className="audit-header-subtitle">Viewing complete customer and financing application context</p>
            </div>
          </div>
          <button
            type="button"
            className="audit-header-close-btn"
            onClick={closeDetailsDrawer}
            aria-label="Close details drawer"
          >
            <X size={18} />
          </button>
        </div>

        {/* Drawer Body - Scrollable */}
        <div className="drawer-body">
          {/* Hero Identity / Overview Banner */}
          <div className="lead-hero-identity-card">
            <div className="lead-hero-left">
              <div className="lead-hero-avatar">{initials}</div>
              <div className="lead-hero-meta">
                <h3 className="lead-hero-name">{selectedLead.name}</h3>
                <div className="lead-hero-tags">
                  <span
                    className="audit-badge"
                    style={{
                      backgroundColor: statusInfo.bg,
                      color: statusInfo.text,
                      border: `1px solid ${statusInfo.border}`,
                    }}
                  >
                    <span
                      style={{
                        width: '5.5px',
                        height: '5.5px',
                        borderRadius: '50%',
                        backgroundColor: statusInfo.dot,
                        flexShrink: 0,
                      }}
                    />
                    {statusInfo.label}
                  </span>

                  {selectedLead.product && (
                    <span className="audit-badge audit-badge-primary">
                      <Package size={11} />
                      {selectedLead.product}
                    </span>
                  )}

                  {selectedLead.createdDate && (
                    <span className="lead-hero-created">
                      <Clock size={12} />
                      {selectedLead.createdDate}
                    </span>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Quick 3-Metric KPI Highlights Strip */}
          <div className="lead-kpi-highlight-grid">
            {/* KPI 1: Applied Amount */}
            <div className="lead-kpi-highlight-card">
              <div
                className="lead-kpi-icon-box"
                style={{
                  background: 'linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%)',
                  color: '#059669',
                  boxShadow: '0 1px 3px rgba(5, 150, 105, 0.15)',
                }}
              >
                <CreditCard size={17} />
              </div>
              <div className="lead-kpi-body">
                <span className="lead-kpi-label">Applied Financing</span>
                <span className="lead-kpi-value" style={{ color: '#059669' }}>
                  {formatRinggit(selectedLead.appliedAmount)}
                </span>
              </div>
            </div>

            {/* KPI 2: Servicing Branch */}
            <div className="lead-kpi-highlight-card">
              <div
                className="lead-kpi-icon-box"
                style={{
                  background: 'linear-gradient(135deg, #eff6ff 0%, #dbeafe 100%)',
                  color: '#2563eb',
                  boxShadow: '0 1px 3px rgba(37, 99, 235, 0.15)',
                }}
              >
                <Building size={17} />
              </div>
              <div className="lead-kpi-body">
                <span className="lead-kpi-label">Servicing Branch</span>
                <span className="lead-kpi-value" title={selectedLead.branch || 'Not Assigned'}>
                  {selectedLead.branch || 'Not Assigned'}
                </span>
              </div>
            </div>

            {/* KPI 3: Sales Executive */}
            <div className="lead-kpi-highlight-card">
              <div
                className="lead-kpi-icon-box"
                style={{
                  background: 'linear-gradient(135deg, #f5f3ff 0%, #ede9fe 100%)',
                  color: '#7c3aed',
                  boxShadow: '0 1px 3px rgba(124, 58, 237, 0.15)',
                }}
              >
                <UserCheck size={17} />
              </div>
              <div className="lead-kpi-body">
                <span className="lead-kpi-label">Assigned Executive</span>
                <span className="lead-kpi-value" title={selectedLead.preferredSalesExecutive || 'Not Assigned'}>
                  {selectedLead.preferredSalesExecutive || 'Not Assigned'}
                </span>
              </div>
            </div>
          </div>

          {/* Section 1: Customer & Identity Information */}
          <section className="lead-section-card">
            <h3 className="lead-section-pill">
              <User size={12} />
              Customer &amp; Identity Information
            </h3>
            <div className="lead-field-grid-2">
              <FieldCard
                apiField="customerName"
                label="Customer Full Name"
                raw={selectedLead.name}
                icon={User}
                iconTone="primary"
                copyable
              />
              <FieldCard
                apiField="icNumber"
                label="IC / Identification Number"
                raw={selectedLead.icNumber}
                icon={Key}
                iconTone="purple"
                copyable
                valueStyle={{ fontFamily: "'SF Mono', 'Fira Code', monospace" }}
              />
              <FieldCard
                apiField="phoneNumber"
                label="Phone Number"
                raw={selectedLead.phone}
                icon={Phone}
                iconTone="success"
                copyable
              />
              <FieldCard
                apiField="email"
                label="Email Address"
                raw={selectedLead.email}
                icon={Mail}
                iconTone="neutral"
                copyable
              />
            </div>
          </section>

          {/* Section 2: Employment & Location Context */}
          <section className="lead-section-card">
            <h3 className="lead-section-pill">
              <Briefcase size={12} />
              Employment &amp; Location Context
            </h3>
            <div className="lead-field-grid-2">
              <FieldCard
                apiField="employerName"
                label="Employer / Company Name"
                raw={selectedLead.employerName}
                icon={Building2}
                iconTone="neutral"
                copyable
              />
              <FieldCard
                apiField="state"
                label="State / Region"
                raw={selectedLead.state}
                icon={MapPin}
                iconTone="amber"
              />
              <FieldCard
                apiField="branch"
                label="Servicing Branch"
                raw={selectedLead.branch || 'Not Assigned'}
                icon={Building}
                iconTone="primary"
              />
              <div className="lead-field-card">
                <span className="lead-field-icon lead-field-icon-purple">
                  <Calendar size={15} />
                </span>
                <div className="lead-field-body">
                  <span className="lead-field-label">Submission Date</span>
                  <span className="lead-field-value">{selectedLead.createdDate || '—'}</span>
                </div>
              </div>
            </div>
          </section>

          {/* Section 3: Product Specific Criteria */}
          {(isHomeFinancing || isMicrofinance) && (
            <section className="lead-section-card">
              <h3 className="lead-section-pill">
                <Package size={12} />
                Product Specific Details
              </h3>
              <div className="lead-field-grid-2">
                <div className="lead-field-card">
                  <span className="lead-field-icon">
                    <Package size={15} />
                  </span>
                  <div className="lead-field-body">
                    <span className="lead-field-label">Product Type</span>
                    <span className="lead-field-value" style={{ fontWeight: 600, color: '#1d4ed8' }}>
                      {formatVal(selectedLead.product)}
                    </span>
                  </div>
                </div>

                {isHomeFinancing && (
                  <>
                    <FieldCard
                      apiField="propertyType"
                      label="Property Type"
                      raw={selectedLead.propertyType}
                      icon={Home}
                      iconTone="primary"
                    />
                    <FieldCard
                      apiField="propertyStatus"
                      label="Property Status"
                      raw={selectedLead.propertyStatus}
                      icon={CheckCircle2}
                      iconTone="success"
                    />
                  </>
                )}

                {isMicrofinance && (
                  <>
                    <FieldCard
                      apiField="companyName"
                      label="Company Name"
                      raw={selectedLead.companyName}
                      icon={Building2}
                      iconTone="purple"
                    />
                    <FieldCard
                      apiField="entityType"
                      label="Entity Type"
                      raw={selectedLead.entityType}
                      icon={Layers}
                      iconTone="neutral"
                    />
                    <FieldCard
                      apiField="dateOfIncorporation"
                      label="Date of Incorporation"
                      raw={selectedLead.dateOfIncorporation}
                      icon={Calendar}
                      iconTone="amber"
                    />
                  </>
                )}
              </div>
            </section>
          )}

          {/* Section 4: Compliance & Consent Record */}
          <section className="lead-section-card">
            <h3 className="lead-section-pill">
              <Shield size={12} />
              Compliance &amp; Consent Record
            </h3>
            <div className="lead-field-grid-2">
              {isFieldVisible(fieldConfig, 'marketingConsent') && (
                <div className="lead-field-card lead-field-card-full">
                  <span className="lead-field-icon lead-field-icon-purple">
                    <FileText size={15} />
                  </span>
                  <div className="lead-field-body">
                    <span className="lead-field-label">
                      {getFieldLabel(fieldConfig, 'marketingConsent', 'Marketing Consent')}
                    </span>
                    <span className="lead-field-value">{formatConsent(selectedLead.marketingConsent)}</span>
                  </div>
                </div>
              )}

              {isFieldVisible(fieldConfig, 'agreedToPrivacyPolicy') && (
                <div className="lead-field-card lead-field-card-full">
                  <span className="lead-field-icon lead-field-icon-success">
                    <CheckCircle2 size={15} />
                  </span>
                  <div className="lead-field-body">
                    <span className="lead-field-label">
                      {getFieldLabel(fieldConfig, 'agreedToPrivacyPolicy', 'Privacy Policy Agreement')}
                    </span>
                    <div className="lead-field-value" style={{ display: 'inline-flex', alignItems: 'center', gap: '6px', color: '#15803d' }}>
                      <span className="audit-badge audit-badge-success">
                        <span className="audit-badge-dot" />
                        Agreed &amp; Accepted
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div className="lead-field-card lead-field-card-full">
                <span className="lead-field-icon lead-field-icon-neutral">
                  <Hash size={15} />
                </span>
                <div className="lead-field-body">
                  <span className="lead-field-label">System Record Reference</span>
                  <span
                    className="lead-field-value"
                    style={{
                      fontFamily: "'SF Mono', 'Fira Code', monospace",
                      fontSize: '12px',
                      color: '#475569',
                    }}
                  >
                    {leadIdStr || '—'}
                  </span>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Sticky Footer */}
        <div className="lead-drawer-footer">
          <div className="lead-footer-meta">
            <span style={{ fontFamily: 'ui-monospace, monospace', color: '#94a3b8' }}>
              Lead ID: {leadIdStr ? (leadIdStr.length > 16 ? `${leadIdStr.slice(0, 16)}…` : leadIdStr) : '—'}
            </span>
            <button
              type="button"
              onClick={handleCopyId}
              style={{
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                color: copiedId ? '#059669' : '#64748b',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '4px',
                padding: '3px 6px',
                fontSize: '11.5px',
                fontWeight: 600,
              }}
              title="Copy Lead ID"
            >
              {copiedId ? <Check size={13} /> : <Copy size={13} />}
              <span>{copiedId ? 'Copied' : 'Copy ID'}</span>
            </button>
          </div>

          <button
            type="button"
            className="lead-footer-close-btn"
            onClick={closeDetailsDrawer}
          >
            Close Details
          </button>
        </div>
      </div>
    </div>
  );
};
