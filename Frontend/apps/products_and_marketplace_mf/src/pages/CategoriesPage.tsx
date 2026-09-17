import { Button, PageHeader } from "@omniconnect/ui";
import { Icon } from "../components/common/Icon";
import { CategoryManagementPanel } from "../components/category/CategoryManagementPanel";
import { useDrawerStore } from "../stores/useDrawerStore";
import { usePermissions } from "../permissions/PermissionContext";
import { PERMISSIONS } from "../permissions/permissions";
import { useShallow } from "zustand/react/shallow";
import "./CategoriesPage.css";

export function CategoriesPage() {
  const { open } = useDrawerStore(useShallow((s) => ({ open: s.open })));
  const { has } = usePermissions();
  const canCreate = has(PERMISSIONS.CATEGORIES_CREATE);

  return (
    <div className="pm-page pm-categories-page">
      <PageHeader
        title="Category Management"
        subtitle="Organize, classify, and configure financial product categories across the marketplace."
        icon={<Icon name="grid" size={24} />}
        actions={
          canCreate && (
            <Button variant="onHeader" leadingIcon={<Icon name="plus" size={16} />} onClick={() => open("category-form", {})}>
              Add Category
            </Button>
          )
        }
      />

      <CategoryManagementPanel />
    </div>
  );
}

