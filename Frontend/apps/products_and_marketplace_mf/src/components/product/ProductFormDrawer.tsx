import { isApprovalPending } from "../../services/httpClient";
import { useEffect, useMemo, useState } from "react";
import { Drawer, DrawerSection } from "../drawer/Drawer";
import { Icon } from "../common/Icon";
import { CustomSelect } from "../common/CustomSelect";
import { formatFieldLabel } from "./ApplyNowDrawer";
import { useProductStore } from "../../stores/useProductStore";
import { useCategoryStore } from "../../stores/useCategoryStore";
import { useDrawerStore } from "../../stores/useDrawerStore";
import { useStatusConfigStore } from "../../stores/useStatusConfigStore";
import { useToastStore } from "../../stores/useToastStore";
import type { ProductBenefitInput, ProductEligibilityInput, ProductStatus } from "../../types/domain";
import "../drawer/DrawerContent.css";
import "./ProductFormDrawer.css";

export function ProductFormDrawer({ productId }: { productId?: string }) {
  const isEdit = !!productId;
  const { close } = useDrawerStore();
  const { categories, fetchAll: fetchCategories } = useCategoryStore();
  const { productTypes, fetchProductTypes, selectedProduct, selectedLoading, fetchProductById, clearSelectedProduct, createProduct, updateProduct } =
    useProductStore();
  const statusConfigs = useStatusConfigStore((s) => s.configs);
  const statusOptions = useMemo(
    () => statusConfigs.filter((c) => c.entityType === "Product").sort((a, b) => a.sortOrder - b.sortOrder),
    [statusConfigs]
  );

  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [shortDescription, setShortDescription] = useState("");
  const [description, setDescription] = useState("");
  const [categoryId, setCategoryId] = useState("");
  const [productTypeId, setProductTypeId] = useState("");
  const [status, setStatus] = useState<ProductStatus>("Draft");
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [benefits, setBenefits] = useState<ProductBenefitInput[]>([]);
  const [eligibility, setEligibility] = useState<ProductEligibilityInput[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchCategories();
    fetchProductTypes();
    if (productId) fetchProductById(productId, false);
    return () => clearSelectedProduct();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  useEffect(() => {
    if (!isEdit || !selectedProduct) return;
    setName(selectedProduct.name);
    setCode(selectedProduct.code);
    setShortDescription(selectedProduct.shortDescription);
    setDescription(selectedProduct.description);
    setCategoryId(selectedProduct.categoryId);
    setProductTypeId(selectedProduct.productTypeId);
    setStatus(selectedProduct.status);
    setFieldValues(Object.fromEntries(selectedProduct.detailFields.map((f) => [f.fieldDefinitionId, f.value])));
    setBenefits(selectedProduct.benefits.map((b) => ({ title: b.title, description: b.description, iconKey: b.iconKey })));
    setEligibility(selectedProduct.eligibilityCriteria.map((e) => ({ criteria: e.criteria, description: e.description })));
  }, [isEdit, selectedProduct]);

  const activeType = useMemo(() => productTypes.find((t) => t.id === productTypeId), [productTypes, productTypeId]);

  async function handleSubmit() {
    if (!name || !code || !categoryId || !productTypeId) {
      setError("Please fill in name, code, category and product type.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const input = {
        name,
        code,
        shortDescription,
        description,
        iconKey: categories.find((c) => c.id === categoryId)?.iconKey || "package",
        categoryId,
        productTypeId,
        status,
        fieldValues: (activeType?.fieldDefinitions ?? []).map((f) => ({ fieldDefinitionId: f.id, value: fieldValues[f.id] ?? "" })),
        benefits,
        eligibilityCriteria: eligibility,
      };
      if (isEdit && productId) {
        await updateProduct(productId, input);
        useToastStore.getState().success("Product Updated", `"${name}" has been updated successfully.`);
      } else {
        await createProduct(input);
        useToastStore.getState().success("Product Created", `"${name}" has been created successfully.`);
      }
      close();
    } catch (err) {
      if (isApprovalPending(err)) return;
      setError((err as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  const loadingInitial = isEdit && selectedLoading;

  return (
    <Drawer
      isOpen
      onClose={close}
      icon={<Icon name="package" size={20} />}
      title={isEdit ? "Edit Product" : "Add Product"}
      subtitle={isEdit ? "Update this product's information and configuration" : "Create a new financial product for the marketplace"}
      footer={
        <button className="pm-btn pm-btn-primary" disabled={submitting || loadingInitial} onClick={handleSubmit}>
          {submitting ? "Saving..." : isEdit ? "Save Changes" : "Create Product"}
        </button>
      }
    >
      {loadingInitial ? (
        <div className="pm-skeleton" style={{ height: 300 }} />
      ) : (
        <>
          {error && <div className="pm-field-error-banner">{error}</div>}

          <DrawerSection title="Basic Information">
            <div className="pm-form-grid">
              <div className="pm-field">
                <label>Product Name *</label>
                <input className="pm-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Personal Loan" />
              </div>
              <div className="pm-field">
                <label>Product Code *</label>
                <input className="pm-input" value={code} onChange={(e) => setCode(e.target.value)} placeholder="e.g. PL-001" />
              </div>
              <div className="pm-field">
                <label>Category *</label>
                <CustomSelect
                  options={categories.map((c) => ({ value: c.id, label: c.name }))}
                  value={categoryId}
                  onChange={(val) => setCategoryId(val)}
                  placeholder="Select category..."
                />
              </div>
              <div className="pm-field">
                <label>Product Type *</label>
                <CustomSelect
                  options={productTypes.map((t) => ({ value: t.id, label: t.name }))}
                  value={productTypeId}
                  onChange={(val) => setProductTypeId(val)}
                  disabled={isEdit}
                  placeholder="Select product type..."
                />
              </div>
              <div className="pm-field pm-field-full">
                <label>Short Description</label>
                <input className="pm-input" value={shortDescription} onChange={(e) => setShortDescription(e.target.value)} placeholder="One-line summary shown on cards" />
              </div>
              <div className="pm-field pm-field-full">
                <label>Full Description</label>
                <textarea className="pm-input" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Detailed product description" />
              </div>
              <div className="pm-field">
                <label>Status</label>
                <CustomSelect
                  options={statusOptions.filter((c) => c.value === status || c.enabled).map((c) => ({ value: c.value, label: c.label }))}
                  value={status}
                  onChange={(val) => setStatus(val as ProductStatus)}
                />
              </div>
            </div>
          </DrawerSection>

          {activeType && activeType.fieldDefinitions.length > 0 && (
            <DrawerSection title={`${activeType.name} Attributes`}>
              <div className="pm-form-grid">
                {activeType.fieldDefinitions
                  .slice()
                  .sort((a, b) => a.sortOrder - b.sortOrder)
                  .map((f) => {
                    const value = fieldValues[f.id] ?? "";
                    const handleChange = (v: string) => setFieldValues({ ...fieldValues, [f.id]: v });
                    const formattedTitle = formatFieldLabel(f.label);
                    return (
                      <div className="pm-field" key={f.id}>
                        <label>
                          {formattedTitle} {f.required && "*"}
                        </label>
                        {f.dataType === "Dropdown" ? (
                          <CustomSelect
                            options={f.options ?? []}
                            value={value}
                            onChange={handleChange}
                            placeholder={`Select ${formattedTitle}...`}
                          />
                        ) : f.dataType === "Boolean" ? (
                          <CustomSelect
                            options={[
                              { value: "true", label: "Yes" },
                              { value: "false", label: "No" },
                            ]}
                            value={value}
                            onChange={handleChange}
                            placeholder="Select Yes / No..."
                          />
                        ) : f.dataType === "Date" ? (
                          <input
                            type="date"
                            className="pm-input"
                            value={value}
                            onChange={(e) => handleChange(e.target.value)}
                          />
                        ) : (
                          <input
                            className="pm-input"
                            value={value}
                            onChange={(e) => handleChange(e.target.value)}
                            placeholder={f.unit ? `Value (${f.unit})` : `Enter ${formattedTitle}`}
                          />
                        )}
                        <span className="pm-hint">{f.dataType}{f.unit ? ` · unit: ${f.unit}` : ""}</span>
                      </div>
                    );
                  })}
              </div>
            </DrawerSection>
          )}

          <DrawerSection
            title="Benefits"
            action={
              <button className="pm-btn pm-btn-ghost pm-btn-sm" onClick={() => setBenefits([...benefits, { title: "", description: "", iconKey: "check" }])}>
                <Icon name="plus" size={14} /> Add
              </button>
            }
          >
            {benefits.map((b, i) => (
              <div className="pm-repeatable-row" key={i}>
                <input className="pm-input" placeholder="Title" value={b.title} onChange={(e) => setBenefits(benefits.map((x, idx) => (idx === i ? { ...x, title: e.target.value } : x)))} />
                <input className="pm-input" placeholder="Description" value={b.description} onChange={(e) => setBenefits(benefits.map((x, idx) => (idx === i ? { ...x, description: e.target.value } : x)))} />
                <button className="pm-icon-btn" onClick={() => setBenefits(benefits.filter((_, idx) => idx !== i))}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
            {benefits.length === 0 && <p className="pm-hint">No benefits added yet.</p>}
          </DrawerSection>

          <DrawerSection
            title="Eligibility Criteria"
            action={
              <button className="pm-btn pm-btn-ghost pm-btn-sm" onClick={() => setEligibility([...eligibility, { criteria: "", description: "" }])}>
                <Icon name="plus" size={14} /> Add
              </button>
            }
          >
            {eligibility.map((e, i) => (
              <div className="pm-repeatable-row" key={i}>
                <input className="pm-input" placeholder="Criteria" value={e.criteria} onChange={(ev) => setEligibility(eligibility.map((x, idx) => (idx === i ? { ...x, criteria: ev.target.value } : x)))} />
                <input className="pm-input" placeholder="Description" value={e.description} onChange={(ev) => setEligibility(eligibility.map((x, idx) => (idx === i ? { ...x, description: ev.target.value } : x)))} />
                <button className="pm-icon-btn" onClick={() => setEligibility(eligibility.filter((_, idx) => idx !== i))}>
                  <Icon name="trash" size={14} />
                </button>
              </div>
            ))}
            {eligibility.length === 0 && <p className="pm-hint">No eligibility criteria added yet.</p>}
          </DrawerSection>
        </>
      )}
    </Drawer>
  );
}
