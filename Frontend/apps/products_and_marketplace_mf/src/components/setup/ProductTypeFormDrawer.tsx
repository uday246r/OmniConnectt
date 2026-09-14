import { useEffect, useState } from "react";
import { Drawer, DrawerSection } from "../drawer/Drawer";
import { Icon } from "../common/Icon";
import { CustomSelect } from "../common/CustomSelect";
import { useSetupStore } from "../../stores/useSetupStore";
import { useDrawerStore } from "../../stores/useDrawerStore";
import { useToastStore } from "../../stores/useToastStore";

const ICONS = ["package", "loan", "credit-card", "accounts", "investments", "insurance", "deposit", "shield", "building", "tag"] as const;

export function ProductTypeFormDrawer({ productTypeId }: { productTypeId?: string }) {
  const isEdit = !!productTypeId;
  const { close } = useDrawerStore();
  const { productTypes, createProductType, updateProductType } = useSetupStore();
  const existing = productTypes.find((t) => t.id === productTypeId);

  const [name, setName] = useState(existing?.name ?? "");
  const [code, setCode] = useState(existing?.code ?? "");
  const [iconKey, setIconKey] = useState(existing?.iconKey ?? "package");
  const [applyButtonLabel, setApplyButtonLabel] = useState(existing?.applyButtonLabel ?? "Apply Now");
  const [shortLabel, setShortLabel] = useState(existing?.shortLabel ?? "");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!existing) return;
    setName(existing.name);
    setCode(existing.code);
    setIconKey(existing.iconKey);
    setApplyButtonLabel(existing.applyButtonLabel || "Apply Now");
    setShortLabel(existing.shortLabel || "");
  }, [existing]);

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Product type name is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const input = {
        name: name.trim(),
        code: code.trim(),
        iconKey,
        applyButtonLabel: applyButtonLabel.trim() || "Apply Now",
        amountFieldLabel: existing?.amountFieldLabel || "Requested Amount",
        shortLabel: shortLabel.trim()
      };
      if (isEdit && productTypeId) {
        await updateProductType(productTypeId, input);
        useToastStore.getState().success("Product Type Updated", `"${name}" has been updated successfully.`);
      } else {
        await createProductType(input);
        useToastStore.getState().success("Product Type Created", `"${name}" has been created successfully.`);
      }
      close();
    } catch (err) {
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
      title={isEdit ? "Edit Product Type" : "Add Product Type"}
      subtitle={isEdit ? "Update this product type" : "Define a new financial product type (e.g. Bond, Gold Loan)"}
      footer={
        <button className="pm-btn pm-btn-primary" disabled={submitting} onClick={handleSubmit}>
          {submitting ? "Saving..." : isEdit ? "Save Changes" : "Create Product Type"}
        </button>
      }
    >
      {error && <div className="pm-field-error-banner">{error}</div>}
      <DrawerSection title="Basic Information">
        <div className="pm-form-grid">
          <div className="pm-field pm-field-full">
            <label>Type Name *</label>
            <input className="pm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Bond" />
          </div>
          <div className="pm-field pm-field-full">
            <label>Code</label>
            <input className="pm-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="Auto-generated from name if left blank" disabled={isEdit} />
            <span className="pm-hint">{isEdit ? "Code cannot be changed after creation." : "Used internally as a stable identifier - lowercase, hyphenated."}</span>
          </div>
          <div className="pm-field">
            <label>Short Badge Label</label>
            <input className="pm-input" value={shortLabel} onChange={(e) => setShortLabel(e.target.value)} placeholder="e.g. Bond, Card, Loan" />
            <span className="pm-hint">Compact label shown on product card badges.</span>
          </div>
          <div className="pm-field">
            <label>Icon</label>
            <CustomSelect
              options={ICONS.map((i) => ({ value: i, label: i }))}
              value={iconKey}
              onChange={(val) => setIconKey(val)}
            />
          </div>
        </div>
      </DrawerSection>
      <DrawerSection title="Call-to-Action">
        <div className="pm-form-grid">
          <div className="pm-field pm-field-full">
            <label>Apply Button Label</label>
            <input
              className="pm-input"
              value={applyButtonLabel}
              onChange={(e) => setApplyButtonLabel(e.target.value)}
              placeholder="e.g. Apply Now, Open Account, Invest Now"
            />
            <span className="pm-hint">Action button text displayed on cards and detail pages.</span>
          </div>
        </div>
      </DrawerSection>
    </Drawer>
  );
}
