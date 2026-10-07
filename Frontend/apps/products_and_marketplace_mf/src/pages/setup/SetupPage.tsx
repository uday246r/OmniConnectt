import { useState } from 'react';
import { Icon, PageHeader } from '@omniconnect/ui';
import { DocumentsSetup } from './DocumentsSetup';
import { FieldsSetup } from './FieldsSetup';
import { StatusesSetup } from './StatusesSetup';
import page from '../page.module.css';
import styles from './setup.module.css';

const TABS_ID = 'setup';

interface SetupTabDef {
  key: string;
  label: string;
  icon: typeof Icon.Grid;
  hint: string;
}

const TABS: SetupTabDef[] = [
  { key: 'fields', label: 'Fields', icon: Icon.Grid, hint: 'The attributes each kind of product carries' },
  { key: 'documents', label: 'Documents', icon: Icon.FileText, hint: 'What a customer is asked to provide' },
  { key: 'statuses', label: 'Statuses', icon: Icon.Activity, hint: 'What a record can be, and which of them are live' },
];

/**
 * Where the catalogue is configured: the attributes products carry, the documents customers are asked
 * for, and the statuses records can hold. Each tab is its own screen; only the active one is mounted, so
 * opening Setup reads nothing the visible tab does not need.
 *
 * Tab bar is styled identically to the host's Approval Center (navBar with accent top border,
 * clean segmented tab buttons, active pill highlight, and status hint).
 */
export function SetupPage() {
  const [active, setActive] = useState(TABS[0].key);
  const current = TABS.find((tab) => tab.key === active) ?? TABS[0];

  return (
    <div className={page.page}>
      <PageHeader icon={<Icon.Settings />} title="Setup" subtitle="Configure fields, required documents and statuses" />

      <div className={styles.navBar}>
        <div className={styles.tabsList} role="tablist" aria-label="Setup configuration views">
          {TABS.map((tab) => {
            const TabIcon = tab.icon;
            const isSelected = active === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                id={`${TABS_ID}-tab-${tab.key}`}
                aria-selected={isSelected}
                aria-controls={`${TABS_ID}-panel-${tab.key}`}
                className={`${styles.tabBtn} ${isSelected ? styles.tabActive : ''}`}
                onClick={() => setActive(tab.key)}
              >
                <TabIcon width={16} height={16} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
        <div className={styles.navHint}>
          <Icon.Info width={14} height={14} />
          <span>{current.hint}</span>
        </div>
      </div>

      {/* The panel is written out rather than using TabPanel: that one adds its own top padding for
          an underlined strip, which on top of the page's own gap left a double space under the bar. */}
      <div role="tabpanel" id={`${TABS_ID}-panel-${active}`} aria-labelledby={`${TABS_ID}-tab-${active}`}>
        {active === 'fields' && <FieldsSetup />}
        {active === 'documents' && <DocumentsSetup />}
        {active === 'statuses' && <StatusesSetup />}
      </div>
    </div>
  );
}
