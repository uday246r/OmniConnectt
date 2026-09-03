import React, { useEffect } from 'react';
import { useCustomerStore } from '../../store/customerStore';
import Customer360 from '../../pages/Customer360';
import AllProducts from '../../pages/AllProducts';
import AllInteractions from '../../pages/AllInteractions';
import AuditLogs from '../../pages/AuditLogs';
import FieldSettings from '../../pages/FieldSettings';

/** The page keys this remote exposes. They match the route segments in Customer360NavigationManifest. */
export type C360Page =
  | 'individual'
  | 'non-individual'
  | 'customer-360'
  | 'products'
  | 'interactions'
  | 'audit-logs'
  | 'field-settings';

interface MainLayoutProps {
  /** Which page to render, decided by the host from the URL. Defaults to the customer view. */
  page?: string;
}

/**
 * Renders one page. That is now this component's entire job.
 *
 * It used to also mount HostSidebarCustomer360Nav, which found the host's sidebar anchor by query
 * selector, appended a chevron button into it and portalled a hardcoded sub-menu beside it. The host
 * renders the sidebar now, and the current page arrives as a prop instead of living in a store the
 * URL never reflected.
 */
export const MainLayout: React.FC<MainLayoutProps> = ({ page }) => {
  const { loadActiveProfile, setCustomerType } = useCustomerStore();

  const activePage = (page ?? 'individual') as C360Page;

  // Individual and Non-Individual are two sidebar rows over one page — they differ only in which
  // customer type the profile opens with. This is the coupling that used to sit in the layout as a
  // side effect of a store write; it stays here because the distinction really is a routing concern.
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
        // Guards a stale bookmark; the host only ever sends a page the navigation tree declared.
        return <Customer360 />;
    }
  };

  return (
    <div className="c360-remote-app-root">
      <div className="c360-workspace-content-area">
        <main className="c360-workspace-viewport">
          {renderActivePage()}
        </main>
      </div>
    </div>
  );
};

export default MainLayout;
