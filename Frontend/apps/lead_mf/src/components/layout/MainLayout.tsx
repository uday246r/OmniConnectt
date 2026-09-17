import React, { useEffect } from 'react';
import { ToastNotification } from '../common/ToastNotification';
import { useLeadStore } from '../../store/useLeadStore';
import { CreateLeadPage } from '../../pages/CreateLeadPage';
import { DashboardPage } from '../../pages/DashboardPage';
import { ViewLeadPage } from '../../pages/ViewLeadPage';
import { AuditLogsPage } from '../../pages/AuditLogsPage';
import { FieldSettingsPage } from '../../pages/FieldSettingsPage';
import { useShallow } from 'zustand/react/shallow';

/** The page keys this remote exposes. They match the route segments declared in LeadNavigationManifest. */
export type LeadPage = 'dashboard' | 'create-lead' | 'view-lead' | 'audit-logs' | 'field-settings';

interface MainLayoutProps {
  /** Which page to render, decided by the host from the URL. Defaults to the dashboard. */
  page?: string;
}

/**
 * Renders one page. That is now this component's entire job.
 *
 * It used to also mount HostSidebarLeadNav, which located the host's own sidebar anchor by query
 * selector, appended a chevron button into it and portalled a hardcoded array of sub-menu items
 * beside it — with permissions enforced by a `visible` boolean in that array. All of that is gone:
 * the host renders the sidebar from the navigation tree, and which page is showing is a prop rather
 * than internal state the URL never saw.
 */
export const MainLayout: React.FC<MainLayoutProps> = ({ page }) => {
  const fetchMasterData = useLeadStore((s) => s.fetchMasterData);

  /*
   * Only the reference data every page's dropdowns share loads here, once; fetchMasterData is a no-op
   * while a load is running or done.
   *
   * The layout used to also load the dashboard charts and the lead list on every mount — for every
   * page, including Create Lead and Audit Logs that show neither — while the Dashboard and Lead
   * Directory pages loaded the same things again. Each page now loads what it displays and nothing
   * else, and this component reads a single store action, so a store write no longer re-renders the
   * whole remote.
   */
  useEffect(() => {
    void fetchMasterData();
  }, [fetchMasterData]);

  const activePage = (page ?? 'dashboard') as LeadPage;

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
        // An unknown segment falls back rather than rendering nothing. The host only ever sends a
        // page the navigation tree declared, so this is a guard against a stale bookmark, not a
        // routine path.
        return <DashboardPage />;
    }
  };

  const isWide =
    activePage === 'dashboard' ||
    activePage === 'view-lead' ||
    activePage === 'audit-logs' ||
    activePage === 'field-settings';

  return (
    <div className="lead-remote-app-root">
      <div className="lead-workspace-content-area">
        <main className={`lead-workspace-viewport${isWide ? ' lead-workspace-viewport--wide' : ''}`}>
          {renderActivePage()}
        </main>
      </div>

      <ToastNotification />
    </div>
  );
};
