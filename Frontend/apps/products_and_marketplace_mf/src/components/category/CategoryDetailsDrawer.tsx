import { useEffect, useState } from "react";
import { Drawer, DrawerSection } from "../drawer/Drawer";
import "../drawer/DrawerContent.css";
import { Icon } from "../common/Icon";
import { StatusBadge } from "../common/StatusBadge";
import { categoryApi } from "../../services/categoryApi";
import { useDrawerStore } from "../../stores/useDrawerStore";
import { formatDate } from "../../utils/fieldFormat";
import type { Category } from "../../types/domain";
import { useShallow } from "zustand/react/shallow";

export function CategoryDetailsDrawer({ categoryId }: { categoryId: string }) {
  const { close } = useDrawerStore(useShallow((s) => ({ close: s.close })));
  const [category, setCategory] = useState<Category | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    categoryApi
      .getById(categoryId)
      .then((data) => {
        setCategory(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [categoryId]);

  return (
    <Drawer
      isOpen
      onClose={close}
      icon={<Icon name={(category?.iconKey as never) || "grid"} size={20} />}
      title={category ? category.name : "Loading..."}
      subtitle={category ? `Category · ${category.slug}` : undefined}
      badge={category && <StatusBadge status={category.status} entityType="Category" />}
    >
      {loading || !category ? (
        <div className="pm-skeleton" style={{ height: 200 }} />
      ) : (
        <>
          <DrawerSection title="Overview" icon="info">
            {category.description ? (
              <p className="pm-detail-description">{category.description}</p>
            ) : (
              <p className="pm-text-muted" style={{ fontSize: 13 }}>No description provided.</p>
            )}
          </DrawerSection>

          <DrawerSection title="Details" icon="grid">
            <div className="pm-detail-fields">
              <div className="pm-detail-field">
                <span>Category Name</span>
                <strong>{category.name}</strong>
              </div>
              <div className="pm-detail-field">
                <span>Slug</span>
                <strong>{category.slug}</strong>
              </div>
              <div className="pm-detail-field">
                <span>Icon</span>
                <strong style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <Icon name={category.iconKey as never} size={16} />
                  {category.iconKey}
                </strong>
              </div>
              <div className="pm-detail-field">
                <span>Status</span>
                <strong><StatusBadge status={category.status} entityType="Category" /></strong>
              </div>
              <div className="pm-detail-field">
                <span>Display Order</span>
                <strong>#{category.displayOrder}</strong>
              </div>
              <div className="pm-detail-field">
                <span>Created On</span>
                <strong>{formatDate(category.createdAt)}</strong>
              </div>
            </div>
          </DrawerSection>

          <DrawerSection title="Statistics" icon="trending-up">
            <div className="pm-detail-fields">
              <div className="pm-detail-field">
                <span>Products</span>
                <strong>{category.productCount} linked products</strong>
              </div>
              <div className="pm-detail-field">
                <span>Sub-Categories</span>
                <strong>{category.subCategoryCount} types</strong>
              </div>
            </div>
          </DrawerSection>
        </>
      )}
    </Drawer>
  );
}
