import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { DashboardPage } from "../pages/DashboardPage";
import { ProductsPage } from "../pages/ProductsPage";
import { CategoriesPage } from "../pages/CategoriesPage";
import { PromotionsPage } from "../pages/PromotionsPage";
import { ApplicationsPage } from "../pages/ApplicationsPage";
import { AuditLogsPage } from "../pages/AuditLogsPage";
import { SetupPage } from "../pages/SetupPage";
import { DrawerHost } from "../components/drawer/DrawerHost";
import { ToastContainer } from "../components/common/ToastContainer";
import { MockPermissionProvider } from "../permissions/PermissionContext";
import { useStatusConfigStore } from "../stores/useStatusConfigStore";
import type { PermissionKey } from "../permissions/permissions";
import { ALL_PERMISSIONS } from "../permissions/permissions";

/**
 * Root component exposed to the Host App via Module Federation.
 *
 * The Host App is expected to:
 *  - mount this component somewhere inside its own <Router> (any router works,
 *    since only relative <Route>/<Routes> are used here)
 *  - eventually replace `grantedPermissions` with the real permission set resolved
 *    from the logged-in user's roles, once Host-side permission wiring is ready.
 *
 * Until then, `grantedPermissions` defaults to the full local mock set so the
 * Product Marketplace remains fully testable standalone.
 */
export function MarketplaceApp({ grantedPermissions = ALL_PERMISSIONS }: { grantedPermissions?: PermissionKey[] }) {
  const fetchStatusConfigs = useStatusConfigStore((s) => s.fetchAll);

  // Loaded once at the remote's root so every StatusBadge/status dropdown across all six pages
  // renders with Setup-configured labels/colors from first paint, not just on the Setup page itself.
  useEffect(() => {
    fetchStatusConfigs();
  }, [fetchStatusConfigs]);

  return (
    <MockPermissionProvider granted={grantedPermissions}>
      <Routes>
        <Route path="dashboard" element={<DashboardPage />} />
        <Route path="products" element={<ProductsPage />} />
        <Route path="categories" element={<CategoriesPage />} />
        <Route path="promotions" element={<PromotionsPage />} />
        <Route path="applications" element={<ApplicationsPage />} />
        <Route path="setup" element={<SetupPage />} />
        <Route path="audit-logs" element={<AuditLogsPage />} />
        <Route path="*" element={<Navigate to="dashboard" replace />} />
      </Routes>
      <DrawerHost />
      <ToastContainer />
    </MockPermissionProvider>
  );
}
