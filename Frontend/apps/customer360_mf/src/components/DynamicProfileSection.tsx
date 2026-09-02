import React from 'react';
import {
  User, MapPin, Phone, Mail, Calendar, Globe, Shield, BookOpen, DollarSign, AlertTriangle,
  Hash, CreditCard, Building2, CheckSquare, TrendingUp, FileText, Briefcase, Eye, EyeOff,
} from 'lucide-react';
import SectionContainer from './SectionContainer';
import type { ContactDetail, CustomerProfile, FieldConfig } from '../types/api';
import { applyMaskingRule, formatFieldValue, hasRevealableValue } from '../utils/fieldMasking';
import styles from './DynamicProfileSection.module.css';

/** Decorative only — which icon a known section heading gets. Not part of the admin-configurable
 * spec (label/visibility/section/order/sensitive/masking), so kept as a small static lookup here
 * rather than a new DB column; an unrecognized section name still renders fine with the fallback. */
const SECTION_ICONS: Record<string, React.ReactNode> = {
  'Personal Details': <User size={16} />,
  'Residency Details': <MapPin size={16} />,
  'Contact Details': <Phone size={16} />,
  'Employment Details': <Briefcase size={16} />,
  'Additional Details': <FileText size={16} />,
  'Referrer & Relationship Information': <User size={16} />,
  'Company Details': <Building2 size={16} />,
  'Online Banking Status': <Globe size={16} />,
  'Business Registration': <FileText size={16} />,
  'Company Information': <Briefcase size={16} />,
  'Contact Information': <Phone size={16} />,
  'RM Manager Information': <User size={16} />,
};

const FIELD_ICONS: Record<string, React.ReactNode> = {
  gender: <User size={14} />, birthDate: <Calendar size={14} />, race: <User size={14} />,
  religion: <Globe size={14} />, bumiStatus: <Shield size={14} />, educationLevel: <BookOpen size={14} />,
  hnwi: <DollarSign size={14} />, pep: <AlertTriangle size={14} />, status: <User size={14} />,
  disabilityStatus: <User size={14} />, branch: <Building2 size={14} />, pdpaTag: <CheckSquare size={14} />,
  phprId: <Hash size={14} />, nationalId: <CreditCard size={14} />, oldId: <CreditCard size={14} />,
  passport: <CreditCard size={14} />, languagePreferred: <Globe size={14} />, mybsnInd: <CheckSquare size={14} />,
  vipTagging: <Shield size={14} />, placeBirth: <MapPin size={14} />, citizenship: <Globe size={14} />,
  resdCode: <Building2 size={14} />, 'contact.fixedAddress': <MapPin size={14} />,
  'contact.padrEmail1': <Mail size={14} />, 'contact.contactNumber': <Phone size={14} />,
  preferComChnl: <Mail size={14} />, marketMessageOpt: <TrendingUp size={14} />,
  jobStatus: <Briefcase size={14} />, employerName: <Building2 size={14} />, employerPhone: <Phone size={14} />,
  employerEmail: <Mail size={14} />, payrollInd: <CheckSquare size={14} />, designation: <User size={14} />,
  occupation: <Briefcase size={14} />, industry: <Building2 size={14} />, annualIncome: <DollarSign size={14} />,
  employerAddress: <MapPin size={14} />, openingDate: <Calendar size={14} />,
  turnedNonResidentDate: <Calendar size={14} />, lastContactDate: <Calendar size={14} />,
  flags: <Shield size={14} />, segmentation: <TrendingUp size={14} />, refEmployeeName: <User size={14} />,
  refEmployeeEmail: <Mail size={14} />, refEmployeeId: <Hash size={14} />, refEmployeePhoneNo: <Phone size={14} />,
  refStaffId: <FileText size={14} />, organizationType: <Building2 size={14} />, country: <Globe size={14} />,
  onlineBankingRegistrationStatus: <User size={14} />, onlineBankingActivationStatus: <Shield size={14} />,
  businessRegDate: <Calendar size={14} />, organizationName: <Building2 size={14} />, brn: <FileText size={14} />,
  brn2: <FileText size={14} />, economicSector: <Building2 size={14} />, companyWebsite: <Globe size={14} />,
  tin: <FileText size={14} />, cifNumber: <FileText size={14} />, residentType: <Globe size={14} />,
  residentAddress: <MapPin size={14} />, rmName: <User size={14} />, rmId: <FileText size={14} />,
  rmBranchCode: <Building2 size={14} />, rmContactNo: <Phone size={14} />,
};

/** contact.X ApiFields live on the separate ContactDetail object (GET /v1/contactinfo), not the
 * profile itself — every other ApiField is read straight off the profile. */
function resolveRawValue(
  profile: CustomerProfile | null,
  contactInfo: ContactDetail | null,
  apiField: string
): unknown {
  if (!apiField) return undefined;

  if (apiField.startsWith('contact.')) {
    const key = apiField.slice('contact.'.length) as keyof ContactDetail;
    const contactVal = contactInfo ? contactInfo[key] : undefined;
    if (contactVal !== undefined && contactVal !== null) return contactVal;
    return profile ? (profile as unknown as Record<string, unknown>)[key] : undefined;
  }

  const profVal = profile ? (profile as unknown as Record<string, unknown>)[apiField] : undefined;
  if (profVal !== undefined && profVal !== null) return profVal;

  if (contactInfo && apiField in contactInfo) {
    return (contactInfo as unknown as Record<string, unknown>)[apiField];
  }

  return undefined;
}

/** Adjacent configs (already sorted by displayOrder) grouped by Section, preserving the order each
 * section first appears in — so admin-chosen displayOrder controls section order too, without a
 * separate "section order" column. */
export function groupBySection(configs: FieldConfig[]): { section: string; fields: FieldConfig[] }[] {
  const groups: { section: string; fields: FieldConfig[] }[] = [];
  for (const config of configs) {
    const last = groups[groups.length - 1];
    if (last && last.section === config.section) {
      last.fields.push(config);
    } else {
      groups.push({ section: config.section, fields: [config] });
    }
  }
  return groups;
}

interface DynamicProfileSectionProps {
  section: string;
  fields: FieldConfig[];
  profile: CustomerProfile | null;
  contactInfo: ContactDetail | null;
  revealed: Record<string, boolean>;
  onToggleReveal: (fieldKey: string, fieldLabel: string, realVal: string) => void;
}

/** Renders one Section's worth of fields exactly as IndividualDetails.tsx/the old inline corporate
 * JSX always did (same `info-cards-grid`/`info-card`/`info-label`/`info-value` classes — pixel
 * parity, not a new look) — except which fields appear, their labels, order, and masking now all
 * come from FieldConfig instead of being hardcoded per field. */
export default function DynamicProfileSection({
  section, fields, profile, contactInfo, revealed, onToggleReveal,
}: DynamicProfileSectionProps) {
  const visibleFields = fields.filter((f) => f.visible);
  if (visibleFields.length === 0) return null;

  return (
    <SectionContainer title={section} icon={SECTION_ICONS[section] ?? <FileText size={16} />}>
      <div className="info-cards-grid">
        {visibleFields.map((config) => {
          const raw = resolveRawValue(profile, contactInfo, config.apiField);
          const revealable = config.sensitive && hasRevealableValue(raw);
          const rawStr = revealable ? String(raw) : '';
          const isRevealed = revealed[config.apiField];

          let displayValue: string;
          if (config.sensitive && revealable) {
            displayValue = isRevealed
              ? formatFieldValue(raw)
              : applyMaskingRule(rawStr, config.maskingRule, config.visibleCharCount);
          } else {
            displayValue = formatFieldValue(raw);
          }

          // Any non-sensitive field whose value happens to be a URL renders as a real link — a
          // generic behavior, not special-cased to one field name (the old inline JSX only did this
          // for "Company Website" specifically).
          const isLink = !config.sensitive && /^(https?:\/\/|www\.)/i.test(displayValue);

          // Long values (addresses, mainly) get the same "full-width" card treatment the old
          // hardcoded JSX gave specific address fields — inferred from content length/label rather
          // than a dedicated config column, since a value that's long is long regardless of which
          // field it's in.
          const isFullWidth = displayValue.length > 40 || /address/i.test(config.displayLabel);

          return (
            <div className={isFullWidth ? 'info-card full-width' : 'info-card'} key={config.id}>
              <div className="info-label">
                {FIELD_ICONS[config.apiField] ?? <FileText size={14} />}
                {config.displayLabel}
              </div>
              {config.sensitive ? (
                <div
                  className={`info-value ${styles.spread}`}
                >
                  <span className={styles.rule}>{displayValue}</span>
                  {revealable && (
                    <button
                      type="button"
                      onClick={() => onToggleReveal(config.apiField, config.displayLabel, rawStr)}
                      className={styles.row}
                      title={isRevealed ? 'Hide details' : 'Reveal details'}
                    >
                      {isRevealed ? <EyeOff size={15} /> : <Eye size={15} />}
                    </button>
                  )}
                </div>
              ) : (
                <div className={`info-value ${styles.text}`} style={isLink ? { color: '#004EEB', wordBreak: 'break-all' } : undefined}>
                  {isLink ? (
                    <a href={displayValue} target="_blank" rel="noreferrer">
                      {displayValue}
                    </a>
                  ) : (
                    displayValue
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </SectionContainer>
  );
}
