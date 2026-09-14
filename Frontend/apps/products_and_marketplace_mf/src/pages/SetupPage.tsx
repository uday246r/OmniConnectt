import { useEffect, useState } from "react";
import { Icon } from "../components/common/Icon";
import { EmptyState, ErrorState, LoadingSkeletonRows } from "../components/common/EmptyState";
import { CategoryManagementPanel } from "../components/category/CategoryManagementPanel";
import { ConfirmModal } from "../components/common/ConfirmModal";
import { useSetupStore } from "../stores/useSetupStore";
import { useDrawerStore } from "../stores/useDrawerStore";
import { useStatusConfigStore } from "../stores/useStatusConfigStore";
import { useToastStore } from "../stores/useToastStore";
import { usePermissions } from "../permissions/PermissionContext";
import { PERMISSIONS } from "../permissions/permissions";
import { formatFieldValue } from "../utils/fieldFormat";
import { useEmploymentTypeStore } from "../stores/useEmploymentTypeStore";
import type { StatusEntityType, EmploymentType } from "../types/domain";
import "./SetupPage.css";

type SetupTab = "product-types" | "documents" | "categories" | "statuses" | "employment-types";

const STATUS_ENTITY_TYPES: StatusEntityType[] = ["Product", "Category", "Promotion", "Application", "Review"];

export function SetupPage() {
  const [tab, setTab] = useState<SetupTab>("product-types");
  const { has } = usePermissions();
  const canManage = has(PERMISSIONS.SETUP_MANAGE);
  const { fetchProductTypes, fetchDocumentDefinitions } = useSetupStore();
  const { fetchAll: fetchEmploymentTypes } = useEmploymentTypeStore();

  const todayFormatted = new Date().toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  // Both product types, documents, and employment types are loaded up front
  useEffect(() => {
    fetchProductTypes();
    fetchDocumentDefinitions();
    fetchEmploymentTypes();
  }, [fetchProductTypes, fetchDocumentDefinitions, fetchEmploymentTypes]);

  return (
    <div className="pm-page pm-setup-page">
      <div className="pm-hero-banner">
        <div className="pm-hero-banner-content">
          <div className="pm-hero-icon-wrap">
            <Icon name="settings" size={26} />
          </div>
          <div className="pm-hero-text">
            <div className="pm-hero-badge-row">
              <span className="pm-hero-live-badge">• Platform Configuration</span>
              <span className="pm-hero-date">{todayFormatted}</span>
            </div>
            <h1>Setup & Configuration</h1>
            <p>Configure product types, dynamic attributes, categories, document rules, employment categories, and lifecycle statuses.</p>
          </div>
        </div>
      </div>

      <div className="pm-tabs pm-mt-4">
        <button className={`pm-tab ${tab === "product-types" ? "active" : ""}`} onClick={() => setTab("product-types")}>
          Product Types & Fields
        </button>
        <button className={`pm-tab ${tab === "categories" ? "active" : ""}`} onClick={() => setTab("categories")}>
          Categories
        </button>
        <button className={`pm-tab ${tab === "documents" ? "active" : ""}`} onClick={() => setTab("documents")}>
          Document Requirements
        </button>
        <button className={`pm-tab ${tab === "employment-types" ? "active" : ""}`} onClick={() => setTab("employment-types")}>
          Employment Types
        </button>
        <button className={`pm-tab ${tab === "statuses" ? "active" : ""}`} onClick={() => setTab("statuses")}>
          Statuses
        </button>
      </div>

      <div className="pm-mt-4">
        {tab === "product-types" && <ProductTypesSetup canManage={canManage} />}
        {tab === "categories" && <CategoryManagementPanel showAddButton />}
        {tab === "documents" && <DocumentsSetup canManage={canManage} />}
        {tab === "employment-types" && <EmploymentTypesSetup canManage={canManage} />}
        {tab === "statuses" && <StatusesSetup canManage={canManage} />}
      </div>
    </div>
  );
}

function ProductTypesSetup({ canManage }: { canManage: boolean }) {
  const { productTypes, loading, error, selectedProductTypeId, fetchProductTypes, selectProductType, removeProductType, removeField } = useSetupStore();
  const { open } = useDrawerStore();

  const [deleteTypeTarget, setDeleteTypeTarget] = useState<typeof productTypes[0] | null>(null);
  const [deleteTypeError, setDeleteTypeError] = useState<string | null>(null);
  const [deleteFieldTarget, setDeleteFieldTarget] = useState<{ typeId: string; field: typeof productTypes[0]["fieldDefinitions"][0] } | null>(null);
  const [deleteFieldError, setDeleteFieldError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    fetchProductTypes();
  }, [fetchProductTypes]);

  const selected = productTypes.find((t) => t.id === selectedProductTypeId) ?? null;

  async function handleConfirmDeleteType() {
    if (!deleteTypeTarget) return;
    const name = deleteTypeTarget.name;
    setIsDeleting(true);
    setDeleteTypeError(null);
    try {
      await removeProductType(deleteTypeTarget.id);
      setDeleteTypeTarget(null);
      useToastStore.getState().success("Product Type Deleted", `"${name}" has been deleted successfully.`);
    } catch (err) {
      setDeleteTypeError((err as Error).message);
      useToastStore.getState().danger("Delete Failed", (err as Error).message);
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleConfirmDeleteField() {
    if (!deleteFieldTarget) return;
    const label = deleteFieldTarget.field.label;
    setIsDeleting(true);
    setDeleteFieldError(null);
    try {
      await removeField(deleteFieldTarget.typeId, deleteFieldTarget.field.id);
      setDeleteFieldTarget(null);
      useToastStore.getState().success("Field Removed", `"${label}" has been removed from schema successfully.`);
    } catch (err) {
      setDeleteFieldError((err as Error).message);
      useToastStore.getState().danger("Delete Failed", (err as Error).message);
    } finally {
      setIsDeleting(false);
    }
  }

  if (loading && productTypes.length === 0) return <LoadingSkeletonRows />;
  if (error) return <ErrorState message={error} onRetry={fetchProductTypes} />;

  return (
    <div className="pm-setup-layout">
      <div className="pm-card pm-setup-list">
        <div className="pm-setup-list-head">
          <h3>All Product Types ({productTypes.length})</h3>
          {canManage && (
            <button className="pm-btn pm-btn-ghost pm-btn-sm" onClick={() => open("product-type-form", {})}>
              <Icon name="plus" size={14} /> Add
            </button>
          )}
        </div>
        {productTypes.length === 0 ? (
          <EmptyState icon="package" title="No product types" description="Create a product type to define schemas." />
        ) : (
          <ul>
            {productTypes.map((t) => (
              <li key={t.id}>
                <button
                  className={`pm-setup-list-item ${t.id === selected?.id ? "active" : ""}`}
                  onClick={() => selectProductType(t.id)}
                >
                  <div className="pm-setup-item-squircle">
                    <Icon name={t.iconKey as never || "package"} size={16} />
                  </div>
                  <div className="pm-flex-1">
                    <strong>{t.name}</strong>
                    <span className="pm-text-muted">{t.fieldDefinitions?.length ?? 0} fields · {t.productCount} products</span>
                  </div>
                  <Icon name="chevron-right" size={14} className="pm-setup-chevron" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="pm-card pm-setup-detail">
        {!selected ? (
          <EmptyState icon="package" title="Select a product type" description="Choose a product type from the list to view and configure its custom attributes." />
        ) : (
          <>
            <div className="pm-setup-detail-head">
              <div className="pm-setup-detail-title-wrap">
                <div className="pm-setup-item-squircle pm-setup-item-squircle-lg">
                  <Icon name={selected.iconKey as never || "package"} size={22} />
                </div>
                <div>
                  <h3>{selected.name}</h3>
                  <p className="pm-text-muted">
                    Code: <code>{selected.code}</code> · <strong>{selected.productCount}</strong> linked products
                  </p>
                </div>
              </div>
              <div className="pm-setup-actions">
                <button className="pm-btn pm-btn-outline pm-btn-sm" onClick={() => open("product-type-details", { productTypeId: selected.id })}>
                  <Icon name="eye" size={14} /> View Type
                </button>
                {canManage && (
                  <>
                    <button className="pm-btn pm-btn-outline pm-btn-sm" onClick={() => open("product-type-form", { productTypeId: selected.id })}>
                      <Icon name="edit" size={14} /> Edit Type
                    </button>
                    <button
                      className="pm-btn pm-btn-danger pm-btn-sm"
                      onClick={() => {
                        setDeleteTypeTarget(selected);
                        setDeleteTypeError(null);
                      }}
                      title="Delete product type"
                    >
                      <Icon name="trash" size={14} /> Delete
                    </button>
                  </>
                )}
              </div>
            </div>

            <div className="pm-setup-fields-head">
              <h4>Configured Custom Fields ({selected.fieldDefinitions?.length ?? 0})</h4>
              {canManage && (
                <button className="pm-btn pm-btn-primary pm-btn-sm" onClick={() => open("field-form", { productTypeId: selected.id })}>
                  <Icon name="plus" size={14} /> Add Field
                </button>
              )}
            </div>

            {!selected.fieldDefinitions || selected.fieldDefinitions.length === 0 ? (
              <EmptyState icon="tag" title="No fields configured" description="Add dynamic attributes (interest rate, tenure, loan amount, etc.) for this product type." />
            ) : (
              <div className="pm-table-wrap">
                <table className="pm-table pm-setup-table">
                  <thead>
                    <tr>
                      <th>Label</th>
                      <th>Key</th>
                      <th>Type</th>
                      <th>Flags</th>
                      <th>Sample Display</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {selected.fieldDefinitions
                      .slice()
                      .sort((a, b) => a.sortOrder - b.sortOrder)
                      .map((f) => (
                        <tr key={f.id}>
                          <td>
                            <strong>{f.label}</strong>
                          </td>
                          <td>
                            <code>{f.key}</code>
                          </td>
                          <td>
                            <span className="pm-badge pm-badge-info">{f.dataType}</span>
                          </td>
                          <td>
                            <div className="pm-field-flags">
                              {f.required && <span className="pm-badge pm-badge-warning">Required</span>}
                              {f.isReadOnly && <span className="pm-badge pm-badge-danger">Read-Only</span>}
                              {f.displayOnCard && <span className="pm-badge pm-badge-success">Card</span>}
                              {f.filterable && <span className="pm-badge pm-badge-neutral">Filter</span>}
                              {f.isPrimaryMetric && <span className="pm-badge pm-badge-info">Primary</span>}
                              {f.isSecondaryMetric && <span className="pm-badge pm-badge-neutral">Secondary</span>}
                            </div>
                          </td>
                          <td className="pm-text-muted">{formatFieldValue(f.dataType, "0", f.unit) === "0" ? "-" : formatFieldValue(f.dataType, "0", f.unit)}</td>
                          <td>
                            <div className="pm-row-actions">
                              <button
                                className="pm-icon-btn"
                                onClick={() => open("field-details", { productTypeId: selected.id, fieldId: f.id })}
                                title="View field details"
                              >
                                <Icon name="eye" size={14} />
                              </button>
                              {canManage && (
                                <>
                                  <button
                                    className="pm-icon-btn pm-icon-btn-edit"
                                    onClick={() => open("field-form", { productTypeId: selected.id, fieldId: f.id })}
                                    title="Edit field definition"
                                  >
                                    <Icon name="edit" size={14} />
                                  </button>
                                  <button
                                    className="pm-icon-btn pm-icon-btn-delete"
                                    onClick={() => {
                                      setDeleteFieldTarget({ typeId: selected.id, field: f });
                                      setDeleteFieldError(null);
                                    }}
                                    title="Delete field"
                                  >
                                    <Icon name="trash" size={14} />
                                  </button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </div>

      <ConfirmModal
        isOpen={!!deleteTypeTarget}
        title="Delete Product Type"
        message="Are you sure you want to delete this product type? This is only possible if no products currently use it."
        entityName={deleteTypeTarget?.name}
        details={deleteTypeTarget ? [
          { label: "Product Type", value: deleteTypeTarget.name },
          { label: "Type Code", value: deleteTypeTarget.code },
          { label: "Products Linked", value: `${deleteTypeTarget.productCount} products` },
          { label: "Configured Fields", value: `${deleteTypeTarget.fieldDefinitions?.length ?? 0} attributes` },
        ] : undefined}
        confirmText="Delete Product Type"
        variant="danger"
        isLoading={isDeleting}
        errorMessage={deleteTypeError}
        onCancel={() => {
          setDeleteTypeTarget(null);
          setDeleteTypeError(null);
        }}
        onConfirm={handleConfirmDeleteType}
      />

      <ConfirmModal
        isOpen={!!deleteFieldTarget}
        title="Remove Schema Field"
        message="Are you sure you want to remove this field? This is only possible if no products currently set a value for it."
        entityName={deleteFieldTarget?.field.label}
        details={deleteFieldTarget ? [
          { label: "Field Label", value: deleteFieldTarget.field.label },
          { label: "Field Key", value: deleteFieldTarget.field.key },
          { label: "Data Type", value: deleteFieldTarget.field.dataType },
          { label: "Required Flag", value: deleteFieldTarget.field.required ? "Yes" : "No" },
          { label: "Show on Card", value: deleteFieldTarget.field.displayOnCard ? "Yes" : "No" },
        ] : undefined}
        confirmText="Remove Field"
        variant="danger"
        isLoading={isDeleting}
        errorMessage={deleteFieldError}
        onCancel={() => {
          setDeleteFieldTarget(null);
          setDeleteFieldError(null);
        }}
        onConfirm={handleConfirmDeleteField}
      />
    </div>
  );
}

function DocumentsSetup({ canManage }: { canManage: boolean }) {
  const { documentDefinitions, loading, error, fetchDocumentDefinitions, removeDocumentDefinition } = useSetupStore();
  const { open } = useDrawerStore();

  const [deleteDocTarget, setDeleteDocTarget] = useState<typeof documentDefinitions[0] | null>(null);
  const [deleteDocError, setDeleteDocError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    fetchDocumentDefinitions();
  }, [fetchDocumentDefinitions]);

  async function handleConfirmDeleteDoc() {
    if (!deleteDocTarget) return;
    const name = deleteDocTarget.name;
    setIsDeleting(true);
    setDeleteDocError(null);
    try {
      await removeDocumentDefinition(deleteDocTarget.id);
      setDeleteDocTarget(null);
      useToastStore.getState().success("Document Requirement Deleted", `"${name}" has been deleted successfully.`);
    } catch (err) {
      setDeleteDocError((err as Error).message);
      useToastStore.getState().danger("Delete Failed", (err as Error).message);
    } finally {
      setIsDeleting(false);
    }
  }

  if (loading && documentDefinitions.length === 0) return <LoadingSkeletonRows />;
  if (error) return <ErrorState message={error} onRetry={fetchDocumentDefinitions} />;

  return (
    <div className="pm-card pm-setup-detail">
      <div className="pm-setup-fields-head" style={{ padding: "0 0 16px" }}>
        <h4>Document Requirements ({documentDefinitions.length})</h4>
        {canManage && (
          <button className="pm-btn pm-btn-primary pm-btn-sm" onClick={() => open("document-form", {})}>
            <Icon name="plus" size={14} /> Add Document
          </button>
        )}
      </div>
      {documentDefinitions.length === 0 ? (
        <EmptyState icon="file" title="No documents configured" description="Define the documents customers must provide during the Apply Now flow." />
      ) : (
        <div className="pm-table-wrap">
          <table className="pm-table pm-setup-table">
            <thead>
              <tr>
                <th>Document Name</th>
                <th>Category</th>
                <th>Applies To</th>
                <th>Required</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {documentDefinitions.map((d) => (
                <tr key={d.id}>
                  <td>
                    <div className="pm-cat-name-cell">
                      <div className="pm-cat-icon-squircle">
                        <Icon name="file" size={16} />
                      </div>
                      <strong
                        style={{ cursor: "pointer", color: "#2563eb" }}
                        onClick={() => open("document-details", { documentId: d.id })}
                        title="View document details"
                      >
                        {d.name}
                      </strong>
                    </div>
                  </td>
                  <td className="pm-text-muted">{d.documentType || "-"}</td>
                  <td>{d.productTypeName ?? <span className="pm-badge pm-badge-neutral">All Types</span>}</td>
                  <td>{d.required ? <span className="pm-badge pm-badge-warning">Required</span> : <span className="pm-badge pm-badge-neutral">Optional</span>}</td>
                  <td>{d.active ? <span className="pm-badge pm-badge-success">Active</span> : <span className="pm-badge pm-badge-danger">Inactive</span>}</td>
                  <td>
                    <div className="pm-row-actions">
                      <button
                        className="pm-icon-btn"
                        onClick={() => open("document-details", { documentId: d.id })}
                        title="View document details"
                      >
                        <Icon name="eye" size={14} />
                      </button>
                      {canManage && (
                        <>
                          <button
                            className="pm-icon-btn pm-icon-btn-edit"
                            onClick={() => open("document-form", { documentId: d.id })}
                            title="Edit document requirement"
                          >
                            <Icon name="edit" size={14} />
                          </button>
                          <button
                            className="pm-icon-btn pm-icon-btn-delete"
                            onClick={() => {
                              setDeleteDocTarget(d);
                              setDeleteDocError(null);
                            }}
                            title="Delete document requirement"
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmModal
        isOpen={!!deleteDocTarget}
        title="Delete Document Requirement"
        message="Are you sure you want to delete this document requirement?"
        entityName={deleteDocTarget?.name}
        details={deleteDocTarget ? [
          { label: "Document Name", value: deleteDocTarget.name },
          { label: "Document Type", value: deleteDocTarget.documentType || "Standard" },
          { label: "Applies To", value: deleteDocTarget.productTypeName || "All Product Types" },
          { label: "Mandatory", value: deleteDocTarget.required ? "Required" : "Optional" },
          { label: "Status", value: deleteDocTarget.active ? "Active" : "Inactive" },
        ] : undefined}
        confirmText="Delete Document"
        variant="danger"
        isLoading={isDeleting}
        errorMessage={deleteDocError}
        onCancel={() => {
          setDeleteDocTarget(null);
          setDeleteDocError(null);
        }}
        onConfirm={handleConfirmDeleteDoc}
      />
    </div>
  );
}

const ENTITY_TYPE_LABELS: Record<StatusEntityType, string> = {
  Product: "Products",
  Category: "Categories",
  Review: "Reviews",
  Promotion: "Promotions",
  Application: "Applications",
};

function StatusesSetup({ canManage }: { canManage: boolean }) {
  const { configs, loading, error, fetchAll, removeConfig } = useStatusConfigStore();
  const { open } = useDrawerStore();

  const [deleteTarget, setDeleteTarget] = useState<typeof configs[0] | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    const label = deleteTarget.label;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await removeConfig(deleteTarget.id);
      setDeleteTarget(null);
      useToastStore.getState().success("Status Configuration Deleted", `"${label}" status has been deleted successfully.`);
    } catch (err) {
      setDeleteError((err as Error).message);
      useToastStore.getState().danger("Delete Failed", (err as Error).message);
    } finally {
      setIsDeleting(false);
    }
  }

  if (loading && configs.length === 0) return <LoadingSkeletonRows />;
  if (error) return <ErrorState message={error} onRetry={fetchAll} />;

  return (
    <div className="pm-setup-statuses">
      {STATUS_ENTITY_TYPES.map((entityType) => {
        const rows = configs
          .filter((c) => c.entityType === entityType)
          .slice()
          .sort((a, b) => a.sortOrder - b.sortOrder);

        return (
          <div className="pm-card" key={entityType}>
            <div className="pm-setup-fields-head" style={{ padding: "16px 16px 0" }}>
              <h4>{ENTITY_TYPE_LABELS[entityType]} Statuses ({rows.length})</h4>
              {canManage && (
                <button className="pm-btn pm-btn-primary pm-btn-sm" onClick={() => open("status-config-form", { entityType })}>
                  <Icon name="plus" size={14} /> Add Status
                </button>
              )}
            </div>
            {rows.length === 0 ? (
              <EmptyState icon="tag" title="No statuses yet" description={`Add the first status for ${ENTITY_TYPE_LABELS[entityType].toLowerCase()}.`} />
            ) : (
            <div className="pm-table-wrap">
              <table className="pm-table">
                <thead>
                  <tr>
                    <th>Value</th>
                    <th>Display Label</th>
                    <th>Preview</th>
                    <th>Sort Order</th>
                    <th>Available</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((c) => (
                    <tr key={c.id}>
                      <td className="pm-text-muted" style={{ fontFamily: "monospace", fontSize: 12 }}>
                        {c.value}
                      </td>
                      <td>
                        <strong
                          style={{ cursor: "pointer", color: "#2563eb", fontWeight: 600 }}
                          onClick={() => open("status-config-details", { statusConfigId: c.id })}
                          title="View status details"
                        >
                          {c.label}
                        </strong>
                      </td>
                      <td>
                        <span className={`pm-badge pm-badge-${c.color}`}>{c.label}</span>
                      </td>
                      <td>{c.sortOrder}</td>
                      <td>
                        {c.enabled ? (
                          <span className="pm-badge pm-badge-success">Enabled</span>
                        ) : (
                          <span className="pm-badge pm-badge-neutral">Disabled</span>
                        )}
                      </td>
                      <td>
                        <div className="pm-row-actions">
                          <button
                            className="pm-icon-btn"
                            onClick={() => open("status-config-details", { statusConfigId: c.id })}
                            title="View status"
                          >
                            <Icon name="eye" size={14} />
                          </button>
                          {canManage && (
                            <>
                              <button
                                className="pm-icon-btn pm-icon-btn-edit"
                                onClick={() => open("status-config-form", { statusConfigId: c.id })}
                                title="Edit status"
                              >
                                <Icon name="edit" size={14} />
                              </button>
                              <button
                                className="pm-icon-btn pm-icon-btn-delete"
                                onClick={() => {
                                  setDeleteTarget(c);
                                  setDeleteError(null);
                                }}
                                title="Delete status"
                              >
                                <Icon name="trash" size={14} />
                              </button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            )}
          </div>
        );
      })}

      <ConfirmModal
        isOpen={!!deleteTarget}
        title="Delete Status"
        message="Are you sure you want to delete this status configuration? This may fail if entities are currently using this status."
        entityName={deleteTarget?.label}
        details={deleteTarget ? [
          { label: "Entity Type", value: deleteTarget.entityType },
          { label: "Status Value", value: deleteTarget.value },
          { label: "Display Label", value: deleteTarget.label },
          { label: "Badge Color", value: deleteTarget.color },
          { label: "Enabled", value: deleteTarget.enabled ? "Yes" : "No" },
          { label: "Sort Order", value: `${deleteTarget.sortOrder}` },
        ] : undefined}
        confirmText="Delete Status"
        variant="danger"
        isLoading={isDeleting}
        errorMessage={deleteError}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}

function EmploymentTypesSetup({ canManage }: { canManage: boolean }) {
  const { items, loading, error, fetchAll, updateEmploymentType, removeEmploymentType } = useEmploymentTypeStore();
  const { open } = useDrawerStore();

  const [search, setSearch] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<EmploymentType | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  const filtered = items.filter((item) =>
    item.name.toLowerCase().includes(search.toLowerCase().trim())
  );

  async function handleToggleActive(item: EmploymentType) {
    try {
      await updateEmploymentType(item.id, {
        name: item.name,
        active: !item.active,
        sortOrder: item.sortOrder,
      });
    } catch {
      // ignore
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    const name = deleteTarget.name;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await removeEmploymentType(deleteTarget.id);
      setDeleteTarget(null);
      useToastStore.getState().success("Employment Type Deleted", `"${name}" has been deleted successfully.`);
    } catch (err) {
      setDeleteError((err as Error).message);
      useToastStore.getState().danger("Delete Failed", (err as Error).message);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <div className="pm-card pm-setup-detail">
      <div className="pm-setup-fields-head" style={{ padding: "0 0 16px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="pm-setup-item-squircle pm-setup-item-squircle-lg">
            <Icon name="briefcase" size={22} />
          </div>
          <div>
            <h4 style={{ margin: 0, fontSize: 16 }}>Customer Employment Types ({items.length})</h4>
            <p className="pm-text-muted" style={{ margin: "2px 0 0", fontSize: 12.5 }}>
              Define options available in customer application forms (e.g. Salaried, Self-Employed, Retired).
            </p>
          </div>
        </div>
        {canManage && (
          <button
            className="pm-btn pm-btn-primary pm-btn-sm"
            onClick={() => open("employment-type-form")}
          >
            <Icon name="plus" size={14} />
            Add Employment Type
          </button>
        )}
      </div>

      <div style={{ marginBottom: 16, maxWidth: 360 }}>
        <div className="pm-search-input">
          <Icon name="search" size={16} />
          <input
            type="text"
            placeholder="Search employment types..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="pm-hero-clear-btn" onClick={() => setSearch("")} title="Clear">
              <Icon name="close" size={14} />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <LoadingSkeletonRows count={4} />
      ) : error ? (
        <ErrorState message={error} onRetry={() => fetchAll(true)} />
      ) : filtered.length === 0 ? (
        <EmptyState
          icon="briefcase"
          title="No employment types found"
          description={search ? "Try refining your search query." : "No employment types configured yet."}
          action={
            canManage && !search ? (
              <button className="pm-btn pm-btn-primary pm-btn-sm" onClick={() => open("employment-type-form")}>
                <Icon name="plus" size={14} />
                Add Employment Type
              </button>
            ) : undefined
          }
        />
      ) : (
        <div className="pm-table-wrap">
          <table className="pm-table pm-setup-table">
            <thead>
              <tr>
                <th style={{ width: 100 }}>Sort Order</th>
                <th>Employment Type</th>
                <th style={{ width: 140 }}>Status</th>
                <th style={{ width: 120 }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => (
                <tr key={item.id}>
                  <td>
                    <span className="pm-badge pm-badge-neutral">
                      #{item.sortOrder}
                    </span>
                  </td>
                  <td>
                    <div className="pm-cat-name-cell">
                      <div className="pm-cat-icon-squircle">
                        <Icon name="briefcase" size={16} />
                      </div>
                      <strong
                        style={{ cursor: "pointer", color: "#2563eb", fontWeight: 600 }}
                        onClick={() => open("employment-type-details", { employmentTypeId: item.id })}
                        title="View employment type details"
                      >
                        {item.name}
                      </strong>
                    </div>
                  </td>
                  <td>
                    <button
                      className={`pm-badge ${item.active ? "pm-badge-success" : "pm-badge-neutral"}`}
                      style={{ cursor: canManage ? "pointer" : "default", border: "none" }}
                      onClick={() => canManage && handleToggleActive(item)}
                      title={canManage ? "Click to toggle active state" : undefined}
                    >
                      {item.active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td>
                    <div className="pm-row-actions">
                      <button
                        className="pm-icon-btn"
                        onClick={() => open("employment-type-details", { employmentTypeId: item.id })}
                        title="View employment type"
                      >
                        <Icon name="eye" size={14} />
                      </button>
                      {canManage && (
                        <>
                          <button
                            className="pm-icon-btn pm-icon-btn-edit"
                            onClick={() => open("employment-type-form", { employmentTypeId: item.id })}
                            title="Edit employment type"
                          >
                            <Icon name="edit" size={14} />
                          </button>
                          <button
                            className="pm-icon-btn pm-icon-btn-delete"
                            onClick={() => {
                              setDeleteTarget(item);
                              setDeleteError(null);
                            }}
                            title="Delete employment type"
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmModal
        isOpen={!!deleteTarget}
        title="Delete Employment Type"
        message="Are you sure you want to delete this employment type option?"
        entityName={deleteTarget?.name}
        details={deleteTarget ? [
          { label: "Employment Type", value: deleteTarget.name },
          { label: "Sort Order", value: `#${deleteTarget.sortOrder}` },
          { label: "Status", value: deleteTarget.active ? "Active" : "Inactive" },
        ] : undefined}
        confirmText="Delete Employment Type"
        variant="danger"
        isLoading={isDeleting}
        errorMessage={deleteError}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}
