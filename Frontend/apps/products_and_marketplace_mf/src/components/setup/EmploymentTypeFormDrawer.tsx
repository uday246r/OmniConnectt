import { isApprovalPending } from "../../services/httpClient";
import { useEffect, useState } from "react";
import { Drawer, DrawerSection } from "../drawer/Drawer";
import { Icon } from "../common/Icon";
import { useEmploymentTypeStore } from "../../stores/useEmploymentTypeStore";
import { useDrawerStore } from "../../stores/useDrawerStore";
import { useToastStore } from "../../stores/useToastStore";
import { useShallow } from "zustand/react/shallow";

export function EmploymentTypeFormDrawer({ employmentTypeId }: { employmentTypeId?: string }) {
  const { close } = useDrawerStore(useShallow((s) => ({ close: s.close })));
  const { items, createEmploymentType, updateEmploymentType } = useEmploymentTypeStore(useShallow((s) => ({ items: s.items, createEmploymentType: s.createEmploymentType, updateEmploymentType: s.updateEmploymentType })));
  const existing = employmentTypeId ? items.find((e) => e.id === employmentTypeId) : undefined;
  const isCreate = !employmentTypeId;

  const [name, setName] = useState(existing?.name ?? "");
  const [active, setActive] = useState(existing?.active ?? true);
  const [sortOrder, setSortOrder] = useState(existing?.sortOrder ?? 1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!existing) return;
    setName(existing.name);
    setActive(existing.active);
    setSortOrder(existing.sortOrder);
  }, [existing]);

  useEffect(() => {
    if (!isCreate) return;
    setSortOrder(items.length + 1);
  }, [isCreate, items.length]);

  if (!isCreate && !existing) return null;

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Employment type name is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      if (isCreate) {
        await createEmploymentType({ name: name.trim(), active, sortOrder });
        useToastStore.getState().success("Employment Type Created", `"${name.trim()}" has been created successfully.`);
      } else {
        await updateEmploymentType(employmentTypeId!, { name: name.trim(), active, sortOrder });
        useToastStore.getState().success("Employment Type Updated", `"${name.trim()}" has been updated successfully.`);
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
      icon={<Icon name="briefcase" size={20} />}
      title={isCreate ? "Add Employment Type" : "Edit Employment Type"}
      subtitle={isCreate ? "Define a new customer employment category for applications" : `Update "${existing!.name}"`}
      footer={
        <button className="pm-btn pm-btn-primary" disabled={submitting} onClick={handleSubmit}>
          {submitting ? "Saving..." : isCreate ? "Create Employment Type" : "Save Changes"}
        </button>
      }
    >
      {error && <div className="pm-field-error-banner">{error}</div>}
      <DrawerSection title="Details">
        <div className="pm-form-grid">
          <div className="pm-field pm-field-full">
            <label>Employment Type Name *</label>
            <input
              className="pm-input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Salaried, Self-Employed, Freelancer"
            />
            <span className="pm-hint">Displayed in the customer Apply Now form and application review.</span>
          </div>
          <div className="pm-field">
            <label>Sort Order</label>
            <input
              className="pm-input"
              type="number"
              min={1}
              value={sortOrder}
              onChange={(e) => setSortOrder(Number(e.target.value))}
            />
          </div>
        </div>
      </DrawerSection>
      <DrawerSection title="Availability">
        <div className="pm-checkbox-grid">
          <label className="pm-checkbox-row">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>
              <strong>Active</strong>
              <span className="pm-hint">When active, this option is offered to customers in the Apply Now flow. Inactive options remain on historical applications.</span>
            </span>
          </label>
        </div>
      </DrawerSection>
    </Drawer>
  );
}
