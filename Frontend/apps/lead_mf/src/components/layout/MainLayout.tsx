import React, { useEffect } from 'react';
import { useHostSubRoute } from '@omniremit/ui';
import { HostSidebarLeadNav } from './HostSidebarLeadNav';
import { ToastNotification } from '../common/ToastNotification';
import { useLeadStore } from '../../store/useLeadStore';
import { CreateLeadPage } from '../../pages/CreateLeadPage';
import { DashboardPage } from '../../pages/DashboardPage';
import { ViewLeadPage } from '../../pages/ViewLeadPage';
import { AuditLogsPage } from '../../pages/AuditLogsPage';
import { FieldSettingsPage } from '../../pages/FieldSettingsPage';
import type { NavigationPage } from '../../types/lead';

/** Every page this remote can be on — also the set of sub-routes it accepts from the URL. */
const LEAD_PAGES: readonly NavigationPage[] = [
  'dashboard',
  'view-lead',
  'create-lead',
  'audit-logs',
  'field-settings',
];

export const MainLayout: React.FC = () => {
  const { activePage, setActivePage, fetchDashboardData, fetchMasterData, fetchLeads, products } = useLeadStore();

  /*
   * Puts the open page in the host's URL: `/apps/lead/audit-logs` rather than a bare `/apps/lead`
   * for every page in the app. Refresh, Back/Forward and shared links all land where the reader
   * actually was. No-ops when this remote runs outside the host shell.
   */
  useHostSubRoute<NavigationPage>({ page: activePage, setPage: setActivePage, pages: LEAD_PAGES });

  /*
   * App-level boot data, once per mount. `products.length` used to be a dependency here too, so the
   * arrival of master data re-ran this whole effect and re-fetched the dashboard AND the leads —
   * the second half of the skeleton → rows → skeleton → rows flicker on the Lead Directory.
   */
  useEffect(() => {
    fetchDashboardData();
    fetchLeads();
  }, [fetchDashboardData, fetchLeads]);

  useEffect(() => {
    if (products.length === 0) {
      fetchMasterData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const renderActivePage = () => {
    switch (activePage) {
      case 'dashboard':
        return <DashboardPage />;
      case 'create-lead':
        return <CreateLeadPage />;
      case 'view-lead':
        return <ViewLeadPage />;
      case 'audit-logs':
        return <AuditLogsPage />;
      case 'field-settings':
        return <FieldSettingsPage />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <div className="lead-remote-app-root">
      {/* Portals collapsible sub-sections directly into Host's main sidebar under Lead Management */}
      <HostSidebarLeadNav />

      {/* Main Workspace Content Area (Full Width) */}
      <div className="lead-workspace-content-area">
        <main className={`lead-workspace-viewport${activePage === 'dashboard' || activePage === 'view-lead' || activePage === 'audit-logs' || activePage === 'field-settings' ? ' lead-workspace-viewport--wide' : ''}`}>
          {renderActivePage()}
        </main>
      </div>

      {/* Global Toast Notification */}
      <ToastNotification />
    </div>
  );
};
