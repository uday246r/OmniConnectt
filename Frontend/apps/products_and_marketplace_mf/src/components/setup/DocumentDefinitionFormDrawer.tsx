import { isApprovalPending } from "../../services/httpClient";
import { CustomSelect } from "../common/CustomSelect";
import { useEffect, useState } from "react";
import { Drawer, DrawerSection } from "../drawer/Drawer";
import { Icon } from "../common/Icon";
import { useSetupStore } from "../../stores/useSetupStore";
import { useDrawerStore } from "../../stores/useDrawerStore";
import { useToastStore } from "../../stores/useToastStore";
import { useShallow } from "zustand/react/shallow";

export function DocumentDefinitionFormDrawer({ documentId }: { documentId?: string }) {
  const isEdit = !!documentId;
  const { close } = useDrawerStore(useShallow((s) => ({ close: s.close })));
  const { documentDefinitions, productTypes, createDocumentDefinition, updateDocumentDefinition } = useSetupStore(useShallow((s) => ({ documentDefinitions: s.documentDefinitions, productTypes: s.productTypes, createDocumentDefinition: s.createDocumentDefinition, updateDocumentDefinition: s.updateDocumentDefinition })));
  const existing = documentDefinitions.find((d) => d.id === documentId);

  const [name, setName] = useState(existing?.name ?? "");
  const [documentType, setDocumentType] = useState(existing?.documentType ?? "");
  const [required, setRequired] = useState(existing?.required ?? true);
  const [active, setActive] = useState(existing?.active ?? true);
  const [productTypeId, setProductTypeId] = useState(existing?.productTypeId ?? "");
  const [sortOrder, setSortOrder] = useState(existing?.sortOrder ?? documentDefinitions.length + 1);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!existing) return;
    setName(existing.name);
    setDocumentType(existing.documentType);
    setRequired(existing.required);
    setActive(existing.active);
    setProductTypeId(existing.productTypeId ?? "");
    setSortOrder(existing.sortOrder);
  }, [existing]);

  async function handleSubmit() {
    if (!name.trim()) {
      setError("Document name is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const input = { name, documentType, required, active, sortOrder, productTypeId: productTypeId || null };
      if (isEdit && documentId) {
        await updateDocumentDefinition(documentId, input);
        useToastStore.getState().success("Document Updated", `"${name}" has been updated successfully.`);
      } else {
        await createDocumentDefinition(input);
        useToastStore.getState().success("Document Created", `"${name}" has been created successfully.`);
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
      icon={<Icon name="file" size={20} />}
      title={isEdit ? "Edit Document" : "Add Document"}
      subtitle="Documents requested from customers during the Apply Now flow"
      footer={
        <button className="pm-btn pm-btn-primary" disabled={submitting} onClick={handleSubmit}>
          {submitting ? "Saving..." : isEdit ? "Save Changes" : "Create Document"}
        </button>
      }
    >
      {error && <div className="pm-field-error-banner">{error}</div>}
      <DrawerSection title="Document Details">
        <div className="pm-form-grid">
          <div className="pm-field pm-field-full">
            <label>Document Name *</label>
            <input className="pm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. PAN Card" />
          </div>
          <div className="pm-field">
            <label>Category</label>
            <input className="pm-input" value={documentType} onChange={(e) => setDocumentType(e.target.value)} placeholder="e.g. Identity, Address, Financial" />
          </div>
          <div className="pm-field">
            <label>Sort Order</label>
            <input className="pm-input" type="number" min={1} value={sortOrder} onChange={(e) => setSortOrder(Number(e.target.value))} />
          </div>
          <div className="pm-field pm-field-full">
            <label>Applies To</label>
            <CustomSelect
              aria-label="Applies to"
              options={[{ value: "", label: "All Product Types" }, ...productTypes.map((t) => ({ value: t.id, label: `${t.name} only` }))]}
              value={productTypeId}
              onChange={setProductTypeId}
            />
          </div>
        </div>
      </DrawerSection>
      <DrawerSection title="Behavior">
        <div className="pm-checkbox-grid">
          <label className="pm-checkbox-row">
            <input type="checkbox" checked={required} onChange={(e) => setRequired(e.target.checked)} />
            <span>
              <strong>Required</strong>
              <span className="pm-hint">Customer must acknowledge this document to submit</span>
            </span>
          </label>
          <label className="pm-checkbox-row">
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>
              <strong>Active</strong>
              <span className="pm-hint">Inactive documents are hidden from the Apply Now flow</span>
            </span>
          </label>
        </div>
      </DrawerSection>
    </Drawer>
  );
}
