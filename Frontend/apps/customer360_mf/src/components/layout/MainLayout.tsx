import React, { useEffect } from 'react';
import { useHostSubRoute } from '@omniremit/ui';
import { HostSidebarCustomer360Nav } from './HostSidebarCustomer360Nav';
import { useNavigationStore, type C360Page } from '../../store/navigationStore';
import { useCustomerStore } from '../../store/customerStore';
import Customer360 from '../../pages/Customer360';
import AllProducts from '../../pages/AllProducts';
import AllInteractions from '../../pages/AllInteractions';
import AuditLogs from '../../pages/AuditLogs';
import FieldSettings from '../../pages/FieldSettings';

/** Every page this remote can be on — also the set of sub-routes it accepts from the URL. */
const C360_PAGES: readonly C360Page[] = [
  'individual',
  'non-individual',
  'customer-360',
  'products',
  'interactions',
  'audit-logs',
  'field-settings',
];

export const MainLayout: React.FC = () => {
  const { activePage, setActivePage } = useNavigationStore();
  const { loadActiveProfile, setCustomerType } = useCustomerStore();

  /*
   * Puts the open page in the host's URL: `/apps/customer360/interactions` rather than a bare
   * `/apps/customer360` for every page. Refresh, Back/Forward and shared links all land where the
   * reader actually was. No-ops when this remote runs outside the host shell.
   */
  useHostSubRoute<C360Page>({ page: activePage, setPage: setActivePage, pages: C360_PAGES });

  useEffect(() => {
    if (activePage === 'individual') {
      setCustomerType('individual');
    } else if (activePage === 'non-individual') {
      setCustomerType('corporate');
    }
  }, [activePage, setCustomerType]);

  useEffect(() => {
    loadActiveProfile();
  }, [loadActiveProfile]);

  const renderActivePage = () => {
    switch (activePage) {
      case 'individual':
      case 'non-individual':
      case 'customer-360':
        return <Customer360 />;
      case 'products':
        return <AllProducts />;
      case 'interactions':
        return <AllInteractions />;
      case 'audit-logs':
        return <AuditLogs />;
      case 'field-settings':
        return <FieldSettings />;
      default:
        return <Customer360 />;
    }
  };

  return (
    <div className="c360-remote-app-root">
      {/* Portals collapsible sub-sections directly into Host's main sidebar under Customer 360 */}
      <HostSidebarCustomer360Nav />

      {/* Main Workspace Content Area (Full Width) */}
      <div className="c360-workspace-content-area">
        <main className="c360-workspace-viewport">
          {renderActivePage()}
        </main>
      </div>
    </div>
  );
};

export default MainLayout;
