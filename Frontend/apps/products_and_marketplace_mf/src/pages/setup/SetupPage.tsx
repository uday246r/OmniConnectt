import { useState } from 'react';
import { Icon, PageHeader, TabPanel, Tabs } from '@omniconnect/ui';
import { DocumentsSetup } from './DocumentsSetup';
import { FieldsSetup } from './FieldsSetup';
import { StatusesSetup } from './StatusesSetup';
import page from '../page.module.css';

const TABS_ID = 'setup';

const TABS = [
  { key: 'fields', label: 'Fields' },
  { key: 'documents', label: 'Documents' },
  { key: 'statuses', label: 'Statuses' },
];

/**
 * Where the catalogue is configured: the attributes products carry, the documents customers are asked
 * for, and the statuses records can hold. Each tab is its own screen; only the active one is mounted, so
 * opening Setup reads nothing the visible tab does not need.
 */
export function SetupPage() {
  const [active, setActive] = useState(TABS[0].key);

  return (
    <div className={page.page}>
      <PageHeader icon={<Icon.Settings />} title="Setup" subtitle="Configure fields, required documents and statuses" />
      <Tabs id={TABS_ID} tabs={TABS} activeKey={active} onChange={setActive} />
      <TabPanel id={TABS_ID} tabId={active} active>
        {active === 'fields' && <FieldsSetup />}
        {active === 'documents' && <DocumentsSetup />}
        {active === 'statuses' && <StatusesSetup />}
      </TabPanel>
    </div>
  );
}
