import React from 'react';
import {
  User, MapPin, Phone, Mail, Calendar, Globe, Shield, BookOpen, DollarSign, AlertTriangle,
  Hash, CreditCard, Building2, CheckSquare, TrendingUp, FileText, Briefcase, Eye, EyeOff,
} from '@omniconnect/ui/icons';
import type { ContactDetail, CustomerProfile, FieldConfig } from '../types/api';
import { applyMaskingRule, formatFieldValue, hasRevealableValue } from '../utils/fieldMasking';
import styles from './DynamicProfileSection.module.css';

/** Decorative section icon lookup — provides distinct visual identity per section */
const SECTION_ICONS: Record<string, React.ReactNode> = {
  'Personal Details': <User size={20} />,
  'Residency Details': <MapPin size={20} />,
  'Contact Details': <Phone size={20} />,
  'Employment Details': <Briefcase size={20} />,
  'Additional Details': <FileText size={20} />,
  'Referrer & Relationship Information': <User size={20} />,
  'Company Details': <Building2 size={20} />,
  'Online Banking Status': <Globe size={20} />,
  'Business Registration': <FileText size={20} />,
  'Company Information': <Building2 size={20} />,
  'Contact Information': <Phone size={20} />,
  'RM Manager Information': <User size={20} />,
  'Registered Address': <MapPin size={20} />,
  'Business Address': <MapPin size={20} />,
  'Mailing Address': <MapPin size={20} />,
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
 * section first appears in. */
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
  profile?: CustomerProfile | null;
  contactInfo?: ContactDetail | null;
  revealed?: Record<string, boolean>;
  onToggleReveal?: (fieldKey: string, fieldLabel: string, realVal: string) => void;
  loading?: boolean;
}

/**
 * Enhanced, modern presentation for customer profile sections.
 * Uses a clean horizontal card-box structure (label on left, value on right)
 * delivering a polished, high-density banking UI without any copy options.
 */
export default function DynamicProfileSection({
  section,
  fields,
  profile = null,
  contactInfo = null,
  revealed = {},
  onToggleReveal = () => {},
  loading = false,
}: DynamicProfileSectionProps) {
  const visibleFields = fields.filter((f) => f.visible);
  if (visibleFields.length === 0) return null;

  return (
    <div className={`${styles.sectionCard} ${styles.cardThemeBlue}`}>
      {/* Section Header */}
      <div className={styles.sectionHeader}>
        <div className={styles.sectionHeaderLeft}>
          <div className={`${styles.sectionIconBadge} ${styles.badgeBlue}`}>
            {SECTION_ICONS[section] ?? <FileText size={20} />}
          </div>
          <div className={styles.sectionTitleBlock}>
            <h3 className={styles.sectionTitle}>{section}</h3>
          </div>
        </div>
        <span className={`${styles.fieldCountBadge} ${styles.countBadgeBlue}`}>
          <span className={styles.countDot} />
          <span className={styles.countNumber}>{visibleFields.length}</span>
          <span className={styles.countText}>{visibleFields.length === 1 ? 'field' : 'fields'}</span>
        </span>
      </div>

      {/* Grid of Clean Field Boxes */}
      <div className={styles.fieldsGrid}>
        {visibleFields.map((config, index) => {
          if (loading) {
            const isFullWidth =
              /address/i.test(config.displayLabel) ||
              /remark/i.test(config.displayLabel) ||
              /description/i.test(config.displayLabel) ||
              config.displayLabel.length > 28;

            const order = typeof config.displayOrder === 'number' ? config.displayOrder : 1;
            // Shimmer box for label (left side) — pure box placeholder rather than text
            const labelMod = (order * 11 + config.displayLabel.length * 5) % 40;
            const labelWidth = isFullWidth ? '35%' : `${72 + labelMod}px`;

            // Shimmer box for value (right side) — pure box placeholder
            const valMod = (order * 17 + config.displayLabel.length * 7) % 35;
            const valWidth = isFullWidth ? '65%' : `${60 + valMod}px`;

            return (
              <div
                key={config.id || config.apiField}
                className={`${styles.fieldBox} ${isFullWidth ? styles.fieldBoxFull : ''}`}
              >
                <div
                  className="c360-skel c360-skel-text"
                  style={{ width: labelWidth, height: '12px', borderRadius: '4px' }}
                />

                <div className={styles.fieldValueContainer}>
                  <div
                    className="c360-skel c360-skel-text"
                    style={{ width: valWidth, height: '14px', borderRadius: '4px' }}
                  />
                </div>
              </div>
            );
          }

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
            const valueToFormat =
              config.apiField === 'gender' && typeof raw === 'string'
                ? ({ M: 'Male', F: 'Female' }[raw.trim().toUpperCase()] ?? raw)
                : raw;
            displayValue = formatFieldValue(valueToFormat);
          }

          const isLink = !config.sensitive && /^(https?:\/\/|www\.)/i.test(displayValue);
          const isFullWidth =
            displayValue.length > 25 ||
            /address/i.test(config.displayLabel) ||
            (config.displayLabel.length > 24 && displayValue.length > 9) ||
            (config.displayLabel.length + displayValue.length > 34);
          const isPlaceholder = displayValue === '_' || displayValue === '-';
          const isStatusActive = displayValue.toUpperCase() === 'ACTIVE' || displayValue.toUpperCase() === 'YES';

          return (
            <div
              key={config.id}
              className={`${styles.fieldBox} ${isFullWidth ? styles.fieldBoxFull : ''}`}
            >
              <span className={styles.fieldLabel}>
                {config.displayLabel}
              </span>

              <div className={styles.fieldValueContainer}>
                {config.sensitive ? (
                  <div className={styles.sensitiveRow}>
                    <span className={`${styles.fieldValue} ${isPlaceholder ? styles.placeholderValue : ''}`}>
                      {displayValue}
                    </span>
                    {revealable && (
                      <button
                        type="button"
                        onClick={() => onToggleReveal(config.apiField, config.displayLabel, rawStr)}
                        className={styles.revealBtn}
                        title={isRevealed ? 'Hide details' : 'Reveal details'}
                      >
                        {isRevealed ? <EyeOff size={15} /> : <Eye size={15} />}
                      </button>
                    )}
                  </div>
                ) : isLink ? (
                  <a href={displayValue} target="_blank" rel="noreferrer" className={styles.linkValue}>
                    {displayValue}
                  </a>
                ) : isStatusActive ? (
                  <span className={styles.statusActive}>
                    {displayValue}
                  </span>
                ) : (
                  <span className={`${styles.fieldValue} ${isPlaceholder ? styles.placeholderValue : ''}`}>
                    {displayValue}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
