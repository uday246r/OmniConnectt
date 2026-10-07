// Imported BEFORE any of this app's own styles, so the platform tokens are defined for them — both
// inside the host and in a standalone preview. This used to sit below the page imports, which made the
// claim false: the tokens landed last in the bundled stylesheet. It was harmless only because
// tokens.css is @layer-wrapped. Every screen's styles are CSS modules, so none of them can leak out.
import '@omniconnect/ui/tokens.css';

import React, { useEffect, type ComponentType } from 'react';
import { AuditLogsPage } from './pages/audit/AuditLogsPage';
import { CategoriesPage } from './pages/categories/CategoriesPage';
import { DashboardPage } from './pages/dashboard/DashboardPage';
import { ProductsPage } from './pages/products/ProductsPage';
import { SetupPage } from './pages/setup/SetupPage';
import { SubCategoriesPage } from './pages/subcategories/SubCategoriesPage';
import { Toasts } from './components/Toasts';
import { PlatformPermissionProvider } from './permissions/PermissionContext';
import { useStatusConfigStore } from './stores/useStatusConfigStore';
import styles from './App.module.css';

export interface ProductsAppProps {
  /**
   * Which page to render. The host resolves this from the URL (/apps/products/categories → "categories")
   * and passes it in. The keys below are the same route segments the backend's navigation publishes.
   */
  page?: string;
}

const PAGES: Record<string, ComponentType> = {
  dashboard: DashboardPage,
  products: ProductsPage,
  categories: CategoriesPage,
  'sub-categories': SubCategoriesPage,
  setup: SetupPage,
  'audit-logs': AuditLogsPage,
};

const DEFAULT_PAGE = 'dashboard';

export const App: React.FC<ProductsAppProps> = ({ page }) => {
  const fetchStatuses = useStatusConfigStore((s) => s.fetchAll);

  // Every screen draws status badges and offers status filters from Setup, so it is read once, up front.
  useEffect(() => {
    void fetchStatuses();
  }, [fetchStatuses]);

  const Page = PAGES[page ?? DEFAULT_PAGE] ?? PAGES[DEFAULT_PAGE];

  return (
    <PlatformPermissionProvider>
      <div className={styles.root}>
        <Page />
        <Toasts />
      </div>
    </PlatformPermissionProvider>
  );
};

export default App;
