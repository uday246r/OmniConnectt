import { isApprovalPending } from "../../services/httpClient";
import { useEffect, useState } from "react";
import { Drawer, DrawerSection } from "../drawer/Drawer";
import { Icon } from "../common/Icon";
import { CustomSelect } from "../common/CustomSelect";
import { useSetupStore } from "../../stores/useSetupStore";
import { useDrawerStore } from "../../stores/useDrawerStore";
import { useToastStore } from "../../stores/useToastStore";
import type { FieldDataType } from "../../types/domain";

const DATA_TYPES: FieldDataType[] = ["Text", "Number", "Currency", "Percentage", "Boolean", "Date", "Dropdown", "MultiSelect"];

export function FieldDefinitionFormDrawer({ productTypeId, fieldId }: { productTypeId: string; fieldId?: string }) {
  const isEdit = !!fieldId;
  const { close } = useDrawerStore();
  const { productTypes, createField, updateField } = useSetupStore();
  const productType = productTypes.find((t) => t.id === productTypeId);
  const existing = productType?.fieldDefinitions.find((f) => f.id === fieldId);

  const [key, setKey] = useState(existing?.key ?? "");
  const [label, setLabel] = useState(existing?.label ?? "");
  const [dataType, setDataType] = useState<FieldDataType>(existing?.dataType ?? "Text");
  const [unit, setUnit] = useState(existing?.unit ?? "");
  const [optionsText, setOptionsText] = useState((existing?.options ?? []).join(", "));
  const [required, setRequired] = useState(existing?.required ?? false);
  const [filterable, setFilterable] = useState(existing?.filterable ?? false);
  const [visibleToCustomer, setVisibleToCustomer] = useState(existing?.visibleToCustomer ?? true);
  const [sortable, setSortable] = useState(existing?.sortable ?? false);
  const [displayOnCard, setDisplayOnCard] = useState(existing?.displayOnCard ?? false);
  const [displayOnDetails, setDisplayOnDetails] = useState(existing?.displayOnDetails ?? true);
  const [displayInApplication, setDisplayInApplication] = useState(existing?.displayInApplication ?? true);
  const [isReadOnly, setIsReadOnly] = useState(existing?.isReadOnly ?? false);
  const [isPrimaryMetric, setIsPrimaryMetric] = useState(existing?.isPrimaryMetric ?? false);
  const [isSecondaryMetric, setIsSecondaryMetric] = useState(existing?.isSecondaryMetric ?? false);
  const [sortOrder, setSortOrder] = useState(existing?.sortOrder ?? (productType?.fieldDefinitions.length ?? 0) + 1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!existing) return;
    setKey(existing.key);
    setLabel(existing.label);
    setDataType(existing.dataType);
    setUnit(existing.unit ?? "");
    setOptionsText((existing.options ?? []).join(", "));
    setRequired(existing.required);
    setFilterable(existing.filterable);
    setVisibleToCustomer(existing.visibleToCustomer);
    setSortable(existing.sortable);
    setDisplayOnCard(existing.displayOnCard);
    setDisplayOnDetails(existing.displayOnDetails);
    setDisplayInApplication(existing.displayInApplication);
    setIsReadOnly(existing.isReadOnly ?? false);
    setIsPrimaryMetric(existing.isPrimaryMetric);
    setIsSecondaryMetric(existing.isSecondaryMetric);
    setSortOrder(existing.sortOrder);
  }, [existing]);

  const needsOptions = dataType === "Dropdown" || dataType === "MultiSelect";

  async function handleSubmit() {
    if (!label.trim()) {
      setError("Display label is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const options = needsOptions
        ? optionsText.split(",").map((o) => o.trim()).filter(Boolean)
        : undefined;
      const input = {
        key,
        label,
        dataType,
        unit: unit || undefined,
        options,
        required,
        filterable,
        visibleToCustomer,
        sortable,
        displayOnCard,
        displayOnDetails,
        displayInApplication,
        isReadOnly,
        isPrimaryMetric,
        isSecondaryMetric,
        sortOrder,
      };
      if (isEdit && fieldId) {
        await updateField(productTypeId, fieldId, input);
        useToastStore.getState().success("Field Updated", `"${label}" has been updated successfully.`);
      } else {
        await createField(productTypeId, input);
        useToastStore.getState().success("Field Added", `"${label}" has been added to schema successfully.`);
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
      icon={<Icon name="tag" size={20} />}
      title={isEdit ? "Edit Field" : "Add Field"}
      subtitle={productType ? `${isEdit ? "Update" : "Create"} an attribute on "${productType.name}"` : undefined}
      footer={
        <button className="pm-btn pm-btn-primary" disabled={submitting} onClick={handleSubmit}>
          {submitting ? "Saving..." : isEdit ? "Save Changes" : "Create Field"}
        </button>
      }
    >
      {error && <div className="pm-field-error-banner">{error}</div>}

      <DrawerSection title="Basic Information">
        <div className="pm-form-grid">
          <div className="pm-field pm-field-full">
            <label>Display Label *</label>
            <input className="pm-input" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Interest Rate" />
          </div>
          <div className="pm-field pm-field-full">
            <label>Field Key</label>
            <input className="pm-input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="Auto-generated from label if left blank" />
            <span className="pm-hint">Stable internal identifier - lowercase, underscored (e.g. interest_rate).</span>
          </div>
          <div className="pm-field">
            <label>Data Type *</label>
            <CustomSelect
              options={DATA_TYPES}
              value={dataType}
              onChange={(val) => setDataType(val as FieldDataType)}
            />
          </div>
          <div className="pm-field">
            <label>Unit / Suffix</label>
            <input className="pm-input" value={unit} onChange={(e) => setUnit(e.target.value)} placeholder="e.g. % p.a., /month" />
          </div>
          {needsOptions && (
            <div className="pm-field pm-field-full">
              <label>Options *</label>
              <input className="pm-input" value={optionsText} onChange={(e) => setOptionsText(e.target.value)} placeholder="Comma-separated, e.g. Low, Moderate, High" />
            </div>
          )}
          <div className="pm-field">
            <label>Sort Order</label>
            <input className="pm-input" type="number" min={1} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
          </div>
        </div>
      </DrawerSection>

      <DrawerSection title="Field Behavior">
        <div className="pm-checkbox-grid">
          <label className="pm-checkbox-row">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            <span>
              <strong>Required</strong>
              <span className="pm-hint">This field is mandatory when creating a product</span>
            </span>
          </label>
          <label className="pm-checkbox-row">
            <input type="checkbox" checked={filterable} onChange={(e) => setFilterable(e.target.checked)} />
            <span>
              <strong>Filterable</strong>
              <span className="pm-hint">Customers can filter products using this field</span>
            </span>
          </label>
          <label className="pm-checkbox-row">
            <input type="checkbox" checked={visibleToCustomer} onChange={(e) => setVisibleToCustomer(e.target.checked)} />
            <span>
              <strong>Visible to Customer</strong>
              <span className="pm-hint">Shown to customers browsing the marketplace</span>
            </span>
          </label>
          <label className="pm-checkbox-row">
            <input type="checkbox" checked={sortable} onChange={(e) => setSortable(e.target.checked)} />
            <span>
              <strong>Sortable</strong>
              <span className="pm-hint">Allow sorting products by this field</span>
            </span>
          </label>
          <label className="pm-checkbox-row">
            <input type="checkbox" checked={displayOnCard} onChange={(e) => setDisplayOnCard(e.target.checked)} />
            <span>
              <strong>Display on Card</strong>
              <span className="pm-hint">Shown on the product's marketplace card</span>
            </span>
          </label>
          <label className="pm-checkbox-row">
            <input type="checkbox" checked={displayOnDetails} onChange={(e) => setDisplayOnDetails(e.target.checked)} />
            <span>
              <strong>Display on Details</strong>
              <span className="pm-hint">Shown in the product details drawer</span>
            </span>
          </label>
          <label className="pm-checkbox-row">
            <input type="checkbox" checked={displayInApplication} onChange={(e) => setDisplayInApplication(e.target.checked)} />
            <span>
              <strong>Display in Application</strong>
              <span className="pm-hint">Shown as a field in the Apply Now flow</span>
            </span>
          </label>
          <label className="pm-checkbox-row">
            <input type="checkbox" checked={isReadOnly} onChange={(e) => setIsReadOnly(e.target.checked)} />
            <span>
              <strong>Read Only in Application</strong>
              <span className="pm-hint">Lock this field as read-only so customers cannot edit it</span>
            </span>
          </label>
          <label className="pm-checkbox-row">
            <input type="checkbox" checked={isPrimaryMetric} onChange={(e) => setIsPrimaryMetric(e.target.checked)} />
            <span>
              <strong>Primary Metric</strong>
              <span className="pm-hint">Featured as the card's headline stat (e.g. Interest Rate)</span>
            </span>
          </label>
          <label className="pm-checkbox-row">
            <input type="checkbox" checked={isSecondaryMetric} onChange={(e) => setIsSecondaryMetric(e.target.checked)} />
            <span>
              <strong>Secondary Metric</strong>
              <span className="pm-hint">Featured as the card's second stat</span>
            </span>
          </label>
        </div>
      </DrawerSection>
    </Drawer>
  );
}
