import React from 'react';
import type { IndividualProfile, ContactDetail, FieldConfig } from '../types/api';
import { useFieldReveal } from '../hooks/useFieldReveal';
import DynamicProfileSection, { groupBySection } from './DynamicProfileSection';
import { DEFAULT_INDIVIDUAL_FIELD_CONFIGS } from '../constants/defaultFieldConfigs';
import styles from './IndividualDetails.module.css';

interface IndividualDetailsProps {
  subTab?: string;
  profile?: IndividualProfile | null;
  contactInfo?: ContactDetail | null;
  fieldConfigs?: FieldConfig[];
  loading?: boolean;
}

/** Which Sections (in FieldConfig) render under which of this page's sub-tabs. */
const SUBTAB_SECTIONS: Record<string, string[]> = {
  personal_details: ['Personal Details'],
  personal: ['Personal Details'],
  personalDetails: ['Personal Details'],

  residency_contact_details: ['Residency Details', 'Contact Details'],
  residency_details: ['Residency Details', 'Contact Details'],
  residency: ['Residency Details'],
  residencyDetails: ['Residency Details'],
  contact_details: ['Contact Details'],
  contact: ['Contact Details'],
  contactDetails: ['Contact Details'],

  employment_details: ['Employment Details'],
  employment: ['Employment Details'],
  employmentDetails: ['Employment Details'],

  additional_relationship_details: ['Additional Details', 'Referrer & Relationship Information'],
  additional_details: ['Additional Details'],
  additional: ['Additional Details'],
  additionalDetails: ['Additional Details'],
  referrer_relationship: ['Referrer & Relationship Information'],
  relationship: ['Referrer & Relationship Information'],
  relationship_details: ['Referrer & Relationship Information'],

  details: ['Personal Details', 'Residency Details', 'Contact Details', 'Employment Details', 'Additional Details', 'Referrer & Relationship Information'],
  overview: ['Personal Details', 'Residency Details', 'Contact Details', 'Employment Details', 'Additional Details', 'Referrer & Relationship Information'],
  all: ['Personal Details', 'Residency Details', 'Contact Details', 'Employment Details', 'Additional Details', 'Referrer & Relationship Information'],
};

export default function IndividualDetails({
  subTab = 'overview',
  profile = null,
  contactInfo = null,
  fieldConfigs = [],
  loading = false,
}: IndividualDetailsProps) {
  const { revealed, toggleReveal } = useFieldReveal({
    customerName: profile?.fullName || 'Unknown',
    customerType: 'Individual',
    customerId: profile?.nationalId || '',
  });

  if (!profile && !loading) return null;

  const sectionsForTab = SUBTAB_SECTIONS[subTab] || [
    'Personal Details',
    'Residency Details',
    'Contact Details',
    'Employment Details',
    'Additional Details',
    'Referrer & Relationship Information',
  ];

  const safeConfigs = fieldConfigs || [];
  const configsByApiField = new Map(safeConfigs.map((config) => [config.apiField, config]));
  const defaultApiFields = new Set(DEFAULT_INDIVIDUAL_FIELD_CONFIGS.map((config) => config.apiField));
  const effectiveConfigs = [
    ...DEFAULT_INDIVIDUAL_FIELD_CONFIGS.map(
      (defaultConfig) => configsByApiField.get(defaultConfig.apiField) ?? defaultConfig
    ),
    ...safeConfigs.filter((config) => !defaultApiFields.has(config.apiField)),
  ];

  const configsForTab = effectiveConfigs
    .filter((f) => sectionsForTab.includes(f.section))
    .sort((a, b) => a.displayOrder - b.displayOrder);
  const grouped = groupBySection(configsForTab);

  const isOverview = ['overview', 'all', 'details'].includes(subTab) || sectionsForTab.length > 2;

  if (isOverview) {
    // Balanced 2-column distribution across full screen to optimize layout and eliminate excess vertical scroll:
    // Col 1 (Left): Personal Details (~20 fields), Contact Details (~4 fields), Referrer & Relationship (~3 fields) -> ~27 fields
    // Col 2 (Right): Employment Details (~10 fields), Residency Details (~4 fields), Additional Details (~5 fields) -> ~19 fields
    const col1Sections = new Set(['Personal Details', 'Contact Details', 'Referrer & Relationship Information']);
    const col1Groups = grouped.filter((g) => col1Sections.has(g.section));
    const col2Groups = grouped.filter((g) => !col1Sections.has(g.section));

    return (
      <div className={styles.twoColumnGrid}>
        <div className={styles.column}>
          {col1Groups.map(({ section, fields }) => (
            <DynamicProfileSection
              key={section}
              section={section}
              fields={fields}
              profile={profile}
              contactInfo={contactInfo}
              revealed={revealed}
              onToggleReveal={toggleReveal}
              loading={loading}
            />
          ))}
        </div>
        <div className={styles.column}>
          {col2Groups.map(({ section, fields }) => (
            <DynamicProfileSection
              key={section}
              section={section}
              fields={fields}
              profile={profile}
              contactInfo={contactInfo}
              revealed={revealed}
              onToggleReveal={toggleReveal}
              loading={loading}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className={styles.singleColumn}>
      {grouped.map(({ section, fields }) => (
        <DynamicProfileSection
          key={section}
          section={section}
          fields={fields}
          profile={profile}
          contactInfo={contactInfo}
          revealed={revealed}
          onToggleReveal={toggleReveal}
          loading={loading}
        />
      ))}
    </div>
  );
}
