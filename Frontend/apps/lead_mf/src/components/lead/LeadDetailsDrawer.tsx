import React, { useEffect, useState } from 'react';
import { Card, Drawer, getInitials } from '@omniremit/ui';
import styles from './LeadDetailsDrawer.module.css';
import {
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
  Sparkles,
} from '@omniremit/ui/icons';
import { useLeadStore } from '../../store/useLeadStore';
import { isFieldVisible, getFieldLabel, type LeadFieldConfig } from '../../config/fieldControlRegistry';
import { applyMaskingRule, hasRevealableValue } from '../../utils/fieldMasking';
import { Badge } from '@omniremit/ui';
import { LeadStatusBadge } from '../../shared/LeadStatusBadge';

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
export const LeadDetailsDrawer: React.FC = () => {
  const { selectedLead, isDetailsDrawerOpen, closeDetailsDrawer, fieldConfig } = useLeadStore();
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [copiedField, setCopiedField] = useState<string | null>(null);

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

  // No audit dispatch on open — opening this drawer renders data already in the browser. The lead
  // VIEW that IS recorded is the server-side one on GET /api/leads/{id}, which the server observes.

  if (!isDetailsDrawerOpen || !selectedLead) return null;

  const initials = getInitials(selectedLead.name);

  const isHomeFinancing =
    fieldConfig.some((f) => f.apiField === 'propertyType') ||
    !!selectedLead.propertyType ||
    !!selectedLead.propertyStatus;
  const isMicrofinance =
    fieldConfig.some((f) => f.apiField === 'dateOfIncorporation') ||
    !!selectedLead.companyName ||
    !!selectedLead.entityType ||
    !!selectedLead.dateOfIncorporation;


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
    mono = false,
  }: {
    apiField: string;
    label: string;
    raw?: string | null;
    icon: React.ComponentType<{ size: number }>;
    iconTone?: 'primary' | 'neutral' | 'purple' | 'success' | 'amber';
    fullWidth?: boolean;
    copyable?: boolean;
    /** Render the value in the platform monospace face (identifiers, account numbers). */
    mono?: boolean;
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
            className={`lead-field-value ${styles.valueRow} ${mono ? styles.monoValue : ''}`}
          >
            <span className={styles.wrapAnywhere}>{displayValue}</span>
            <div className={styles.inlineChip}>
              {canReveal && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleReveal(apiField);
                  }}
                  className={styles.iconBtn}
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
                  className={`${styles.iconBtn}${isCopied ? ` ${styles.iconBtnCopied}` : ''}`}
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
    <Drawer
      open
      onClose={closeDetailsDrawer}
      closeLabel="Close details drawer"
      title="Lead Record Details"
      subtitle="Viewing complete customer and financing application context"
      icon={<Shield size={22} />}
    >
          {/* Hero Identity / Overview Banner */}
          <div className="lead-hero-identity-card">
            <div className="lead-hero-left">
              <div className="lead-hero-avatar">{initials}</div>
              <div className="lead-hero-meta">
                <h3 className="lead-hero-name">{selectedLead.name}</h3>
                <div className="lead-hero-tags">
                  <LeadStatusBadge status={selectedLead.status} />

                  {selectedLead.product && (
                    <Badge tone="primary">
                      <Package size={11} />
                      {selectedLead.product}
                      </Badge>
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
                className={`lead-kpi-icon-box ${styles.tileSuccess}`}
              >
                <CreditCard size={17} />
              </div>
              <div className="lead-kpi-body">
                <span className="lead-kpi-label">Applied Financing</span>
                <span className={`lead-kpi-value ${styles.valueSuccess}`}>
                  {formatRinggit(selectedLead.appliedAmount)}
                </span>
              </div>
            </div>

            {/* KPI 2: Servicing Branch */}
            <div className="lead-kpi-highlight-card">
              <div
                className={`lead-kpi-icon-box ${styles.tileInfo}`}
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
                className={`lead-kpi-icon-box ${styles.tilePurple}`}
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
                mono
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
              <Card size="sm" row>
                <span className="lead-field-icon lead-field-icon-purple">
                  <Calendar size={15} />
                </span>
                <div className="lead-field-body">
                  <span className="lead-field-label">Submission Date</span>
                  <span className="lead-field-value">{selectedLead.createdDate || '—'}</span>
                </div>
              </Card>
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
                <Card size="sm" row>
                  <span className="lead-field-icon">
                    <Package size={15} />
                  </span>
                  <div className="lead-field-body">
                    <span className="lead-field-label">Product Type</span>
                    <span className={`lead-field-value ${styles.valuePrimary}`}>
                      {formatVal(selectedLead.product)}
                    </span>
                  </div>
                </Card>

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
                    <div className={`lead-field-value ${styles.successRow}`}>
                      <Badge tone="success" dot>
                        Agreed &amp; Accepted
                      </Badge>
                    </div>
                  </div>
                </div>
              )}

            </div>
          </section>
    </Drawer>
  );
};
