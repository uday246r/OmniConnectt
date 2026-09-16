import React, { useEffect } from 'react';
import { DashboardPage } from './pages/DashboardPage';
import { ProductsPage } from './pages/ProductsPage';
import { CategoriesPage } from './pages/CategoriesPage';
import { PromotionsPage } from './pages/PromotionsPage';
import { ApplicationsPage } from './pages/ApplicationsPage';
import { AuditLogsPage } from './pages/AuditLogsPage';
import { SetupPage } from './pages/SetupPage';
import { DrawerHost } from './components/drawer/DrawerHost';
import { ToastContainer } from './components/common/ToastContainer';
import { PlatformPermissionProvider } from './permissions/PermissionContext';
import { HostNavigationProvider, type NavigateToPage } from './navigation/HostNavigation';
import { useStatusConfigStore } from './stores/useStatusConfigStore';

// Standalone fallback tokens. Imported BEFORE this app's own stylesheet so tokens resolve
// gracefully both inside and outside the host shell.
import '@omniconnect/ui/tokens.css';
import './styles/global.css';

export interface ProductsAppProps {
  /**
   * Which page to render. The host resolves this from the URL
   * (/apps/products/products → "products") and passes it in.
   */
  page?: string;

  /** Lets in-app links ask the host to navigate, keeping URL synchronized. */
  onNavigate?: NavigateToPage;
}

export const App: React.FC<ProductsAppProps> = ({ page, onNavigate }) => {
  const fetchStatusConfigs = useStatusConfigStore((s) => s.fetchAll);

  useEffect(() => {
    fetchStatusConfigs();
  }, [fetchStatusConfigs]);

  const activePage = page ?? 'dashboard';

  const renderActivePage = () => {
    switch (activePage) {
      case 'dashboard':
        return <DashboardPage />;
      case 'products':
        return <ProductsPage />;
      case 'categories':
        return <CategoriesPage />;
      case 'promotions':
        return <PromotionsPage />;
      case 'applications':
        return <ApplicationsPage />;
      case 'setup':
        return <SetupPage />;
      case 'audit-logs':
        return <AuditLogsPage />;
      default:
        return <DashboardPage />;
    }
  };

  return (
    <HostNavigationProvider value={onNavigate ?? (() => {})}>
      <PlatformPermissionProvider>
        <div id="products-mf-scope" style={{ width: '100%', minHeight: '100%' }}>
          {renderActivePage()}
          <DrawerHost />
          <ToastContainer />
        </div>
      </PlatformPermissionProvider>
    </HostNavigationProvider>
  );
};

export default App;
