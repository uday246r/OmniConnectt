import React, { useEffect, type ComponentType } from 'react';
import { AuditLogsPage } from './pages/audit/AuditLogsPage';
import { CategoriesPage } from './pages/categories/CategoriesPage';
import { Toasts } from './components/Toasts';
import { PlatformPermissionProvider } from './permissions/PermissionContext';
import { useStatusConfigStore } from './stores/useStatusConfigStore';

// Imported BEFORE any of this app's own styles, so the platform tokens are defined for them — both inside
// the host and in a standalone preview. Every screen's styles are CSS modules, so none of them can leak out.
import '@omniconnect/ui/tokens.css';

export interface ProductsAppProps {
  /**
   * Which page to render. The host resolves this from the URL (/apps/products/categories → "categories")
   * and passes it in. The keys below are the same route segments the backend's navigation publishes.
   */
  page?: string;
}

const PAGES: Record<string, ComponentType> = {
  categories: CategoriesPage,
  'audit-logs': AuditLogsPage,
};

const DEFAULT_PAGE = 'categories';

export const App: React.FC<ProductsAppProps> = ({ page }) => {
  const fetchStatuses = useStatusConfigStore((s) => s.fetchAll);

  // Every screen draws status badges and offers status filters from Setup, so it is read once, up front.
  useEffect(() => {
    void fetchStatuses();
  }, [fetchStatuses]);

  const Page = PAGES[page ?? DEFAULT_PAGE] ?? PAGES[DEFAULT_PAGE];

  return (
    <PlatformPermissionProvider>
      <div style={{ width: '100%', minHeight: '100%' }}>
        <Page />
        <Toasts />
      </div>
    </PlatformPermissionProvider>
  );
};

export default App;
