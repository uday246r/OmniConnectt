import { useState } from 'react';
import { Icon, PageHeader, Tabs } from '@omniconnect/ui';
import { DocumentsSetup } from './DocumentsSetup';
import { FieldsSetup } from './FieldsSetup';
import { StatusesSetup } from './StatusesSetup';
import page from '../page.module.css';
import styles from './setup.module.css';

const TABS_ID = 'setup';

const TABS = [
  { key: 'fields', label: 'Fields', hint: 'The attributes each kind of product carries' },
  { key: 'documents', label: 'Documents', hint: 'What a customer is asked to provide' },
  { key: 'statuses', label: 'Statuses', hint: 'What a record can be, and which of them are live' },
];

/**
 * Where the catalogue is configured: the attributes products carry, the documents customers are asked
 * for, and the statuses records can hold. Each tab is its own screen; only the active one is mounted, so
 * opening Setup reads nothing the visible tab does not need.
 *
 * The three views are equally-weighted, top-level parts of one page, so they are a segmented control
 * in a bar of its own — the treatment the host gives the same situation on its user-detail and
 * approval screens — rather than an underlined strip sitting bare on the page background, which is
 * the lighter treatment the platform keeps for a minor sub-navigation.
 */
export function SetupPage() {
  const [active, setActive] = useState(TABS[0].key);
  const current = TABS.find((tab) => tab.key === active) ?? TABS[0];

  return (
    <div className={page.page}>
      <PageHeader icon={<Icon.Settings />} title="Setup" subtitle="Configure fields, required documents and statuses" />

      <div className={styles.navBar}>
        <Tabs id={TABS_ID} variant="pill" tabs={TABS} activeKey={active} onChange={setActive} />
        <span className={styles.navHint}>{current.hint}</span>
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
