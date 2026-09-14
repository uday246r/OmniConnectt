import { Icon } from "../components/common/Icon";
import { CategoryManagementPanel } from "../components/category/CategoryManagementPanel";
import { useDrawerStore } from "../stores/useDrawerStore";
import { usePermissions } from "../permissions/PermissionContext";
import { PERMISSIONS } from "../permissions/permissions";
import "./CategoriesPage.css";

export function CategoriesPage() {
  const { open } = useDrawerStore();
  const { has } = usePermissions();
  const canCreate = has(PERMISSIONS.CATEGORIES_CREATE);

  const todayFormatted = new Date().toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  return (
    <div className="pm-page pm-categories-page">
      <div className="pm-hero-banner">
        <div className="pm-hero-banner-content">
          <div className="pm-hero-icon-wrap">
            <Icon name="grid" size={26} />
          </div>
          <div className="pm-hero-text">
            <div className="pm-hero-badge-row">
              <span className="pm-hero-live-badge">• Live Directory</span>
              <span className="pm-hero-date">{todayFormatted}</span>
            </div>
            <h1>Category Management</h1>
            <p>Organize, classify, and configure financial product categories across the marketplace.</p>
          </div>
        </div>
        {canCreate && (
          <div className="pm-hero-actions">
            <button className="pm-btn pm-hero-add-btn" onClick={() => open("category-form", {})}>
              <Icon name="plus" size={16} /> Add Category
            </button>
          </div>
        )}
      </div>

      <CategoryManagementPanel />
    </div>
  );
}

