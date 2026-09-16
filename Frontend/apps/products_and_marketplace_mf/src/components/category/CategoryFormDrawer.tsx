import { isApprovalPending } from "../../services/httpClient";
import { CustomSelect } from "../common/CustomSelect";
import { useEffect, useMemo, useState } from "react";
import { Drawer, DrawerSection } from "../drawer/Drawer";
import { Icon } from "../common/Icon";
import { useCategoryStore } from "../../stores/useCategoryStore";
import { useDrawerStore } from "../../stores/useDrawerStore";
import { useStatusConfigStore } from "../../stores/useStatusConfigStore";
import { useToastStore } from "../../stores/useToastStore";
import type { CategoryStatus } from "../../types/domain";

const ICONS = ["package", "loans", "credit-card", "accounts", "investments", "insurance", "deposits", "shield", "building", "tag"] as const;

export function CategoryFormDrawer({ categoryId }: { categoryId?: string }) {
  const isEdit = !!categoryId;
  const { close } = useDrawerStore();
  const { categories, createCategory, updateCategory } = useCategoryStore();
  const statusConfigs = useStatusConfigStore((s) => s.configs);
  const statusOptions = useMemo(
    () => statusConfigs.filter((c) => c.entityType === "Category").sort((a, b) => a.sortOrder - b.sortOrder),
    [statusConfigs]
  );
  const existing = categories.find((c) => c.id === categoryId);

  const [name, setName] = useState(existing?.name ?? "");
  const [description, setDescription] = useState(existing?.description ?? "");
  const [iconKey, setIconKey] = useState(existing?.iconKey ?? "package");
  const [status, setStatus] = useState<CategoryStatus>(existing?.status ?? "Active");
  const [displayOrder, setDisplayOrder] = useState(existing?.displayOrder ?? categories.length + 1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!existing) return;
    setName(existing.name);
    setDescription(existing.description);
    setIconKey(existing.iconKey);
    setStatus(existing.status);
    setDisplayOrder(existing.displayOrder);
  }, [existing]);

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Category name is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const input = { name, description, iconKey, status, displayOrder };
      if (isEdit && categoryId) {
        await updateCategory(categoryId, input);
        useToastStore.getState().success("Category Updated", `"${name}" has been updated successfully.`);
      } else {
        await createCategory(input);
        useToastStore.getState().success("Category Created", `"${name}" has been created successfully.`);
      }
      close();
    } catch (err) {
      if (isApprovalPending(err)) return;
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Drawer
      isOpen
      onClose={close}
      icon={<Icon name={iconKey as never} size={20} />}
      title={isEdit ? "Edit Category" : "Add Category"}
      subtitle={isEdit ? "Update category details" : "Create a new product category"}
      footer={
        <button className="pm-btn pm-btn-primary" disabled={submitting} onClick={handleSubmit}>
          {submitting ? "Saving..." : isEdit ? "Save Changes" : "Create Category"}
        </button>
      }
    >
      {error && <div className="pm-field-error-banner">{error}</div>}
      <DrawerSection title="Basic Information">
        <div className="pm-form-grid">
          <div className="pm-field pm-field-full">
            <label>Category Name *</label>
            <input className="pm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Loans" />
          </div>
          <div className="pm-field pm-field-full">
            <label>Description</label>
            <textarea className="pm-input" rows={2} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Short description shown to customers" />
          </div>
          <div className="pm-field">
            <label>Icon</label>
            <CustomSelect aria-label="Icon" options={ICONS} value={iconKey} onChange={setIconKey} />
          </div>
          <div className="pm-field">
            <label>Status</label>
            <CustomSelect
              aria-label="Status"
              options={statusOptions.filter((c) => c.value === status || c.enabled).map((c) => ({ value: c.value, label: c.label }))}
              value={status}
              onChange={(v) => setStatus(v as CategoryStatus)}
            />
          </div>
          <div className="pm-field">
            <label>Sort Order</label>
            <input className="pm-input" type="number" min={1} value={displayOrder} onChange={(e) => setDisplayOrder(Number(e.target.value))} />
          </div>
        </div>
      </DrawerSection>
    </Drawer>
  );
}
