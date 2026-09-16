import { Pagination } from "@omniremit/ui";
import { isApprovalPending } from "../../services/httpClient";
import { useEffect, useMemo, useState } from "react";
import { Icon } from "../common/Icon";
import { StatusBadge } from "../common/StatusBadge";
import { CustomSelect } from "../common/CustomSelect";
import { EmptyState, ErrorState, LoadingSkeletonRows } from "../common/EmptyState";
import { ConfirmModal } from "../common/ConfirmModal";
import { useCategoryStore } from "../../stores/useCategoryStore";
import { useStatusConfigStore } from "../../stores/useStatusConfigStore";
import { useDrawerStore } from "../../stores/useDrawerStore";
import { useToastStore } from "../../stores/useToastStore";
import { usePermissions } from "../../permissions/PermissionContext";
import { PERMISSIONS } from "../../permissions/permissions";
import { formatDate } from "../../utils/fieldFormat";
import type { Category } from "../../types/domain";
import "../../pages/CategoriesPage.css";

export function CategoryManagementPanel({ showAddButton = false }: { showAddButton?: boolean }) {
  const { categories, loading, error, statusFilter, searchTerm, setStatusFilter, setSearchTerm, fetchAll, updateCategory, removeCategory } = useCategoryStore();
  const { open } = useDrawerStore();
  const { has } = usePermissions();
  const { configs: statusConfigs, fetchAll: fetchStatusConfigs } = useStatusConfigStore();

  // Category statuses come from Setup (StatusConfig) exactly like every other entity's filter, so a
  // status an admin renames, adds or disables there is reflected here without a code change.
  const categoryStatuses = useMemo(
    () =>
      statusConfigs
        .filter((c) => c.entityType === "Category" && c.enabled)
        .sort((a, b) => a.sortOrder - b.sortOrder),
    [statusConfigs]
  );

  const [deleteTarget, setDeleteTarget] = useState<Category | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [pageSizeOption, setPageSizeOption] = useState<string>("10");
  const [customPageSize, setCustomPageSize] = useState<number>(15);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [orderValues, setOrderValues] = useState<Record<string, number | string>>({});

  const handleOrderChange = (id: string, valStr: string) => {
    setOrderValues((prev) => ({ ...prev, [id]: valStr }));
  };

  const handleOrderSubmit = async (c: Category) => {
    const currentVal = orderValues[c.id];
    if (currentVal === undefined || currentVal === "") return;
    const numVal = parseInt(String(currentVal), 10);
    if (isNaN(numVal) || numVal < 1 || numVal === c.displayOrder) {
      setOrderValues((prev) => {
        const next = { ...prev };
        delete next[c.id];
        return next;
      });
      return;
    }
    try {
      await updateCategory(c.id, {
        name: c.name,
        description: c.description || "",
        iconKey: c.iconKey || "",
        status: c.status,
        displayOrder: numVal,
      });
    } finally {
      setOrderValues((prev) => {
        const next = { ...prev };
        delete next[c.id];
        return next;
      });
    }
  };

  useEffect(() => {
    fetchAll();
  }, [statusFilter, fetchAll]);

  useEffect(() => {
    fetchStatusConfigs();
  }, [fetchStatusConfigs]);

  const filtered = useMemo(() => {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return categories;
    return categories.filter((c) => c.name.toLowerCase().includes(term) || (c.description && c.description.toLowerCase().includes(term)));
  }, [categories, searchTerm]);

  const pageSizeNum = useMemo(() => {
    if (pageSizeOption === "all") return null;
    if (pageSizeOption === "custom") return customPageSize || 10;
    return parseInt(pageSizeOption, 10) || 10;
  }, [pageSizeOption, customPageSize]);

  const totalPages = pageSizeNum ? Math.ceil(filtered.length / pageSizeNum) || 1 : 1;
  const validCurrentPage = Math.min(Math.max(1, currentPage), totalPages);

  const displayedCategories = useMemo(() => {
    if (!pageSizeNum) return filtered;
    const start = (validCurrentPage - 1) * pageSizeNum;
    return filtered.slice(start, start + pageSizeNum);
  }, [filtered, pageSizeNum, validCurrentPage]);

  // totalProductCount rolls up products filed under sub-categories too, so the catalog KPI counts
  // every linked product rather than only those attached directly to a top-level category.
  const totalProducts = categories.reduce((a, c) => a + c.totalProductCount, 0);
  const totalSubCategories = categories.reduce((a, c) => a + c.subCategoryCount, 0);
  // The "live" status is whichever status Setup lists first for categories, so this KPI keeps working
  // if that status is renamed instead of being pinned to the literal "Active".
  const liveStatus = categoryStatuses[0];
  const activeCount = liveStatus ? categories.filter((c) => c.status === liveStatus.value).length : 0;

  const canCreate = has(PERMISSIONS.CATEGORIES_CREATE);
  const canEdit = has(PERMISSIONS.CATEGORIES_EDIT);
  const canDelete = has(PERMISSIONS.CATEGORIES_DELETE);

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    const name = deleteTarget.name;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await removeCategory(deleteTarget.id);
      setDeleteTarget(null);
      useToastStore.getState().success("Category Deleted", `"${name}" has been deleted successfully.`);
    } catch (err) {
      if (isApprovalPending(err)) return;
      setDeleteError((err as Error).message);
      useToastStore.getState().danger("Delete Failed", (err as Error).message);
    } finally {
      setIsDeleting(false);
    }
  }

  return (
    <>
      {showAddButton && canCreate && (
        <div className="pm-setup-fields-head">
          <h4>Categories</h4>
          <button className="pm-btn pm-btn-primary pm-btn-sm" onClick={() => open("category-form", {})}>
            <Icon name="plus" size={14} /> Add Category
          </button>
        </div>
      )}

      <div className="pm-kpi-grid">
        <div className="pm-kpi-card pm-kpi-tone-blue">
          <div className="pm-kpi-top">
            <div className="pm-kpi-icon pm-kpi-icon-blue">
              <Icon name="grid" size={20} />
            </div>
            <span className="pm-kpi-label">Total Categories</span>
          </div>
          <div className="pm-kpi-value-row">
            <span className="pm-kpi-value">{categories.length}</span>
          </div>
          <div className="pm-kpi-trend-row">
            <span className="pm-badge pm-badge-info">Platform-wise</span>
            <span className="pm-kpi-subtitle">Master Taxonomy</span>
          </div>
        </div>

        <div className="pm-kpi-card pm-kpi-tone-green">
          <div className="pm-kpi-top">
            <div className="pm-kpi-icon pm-kpi-icon-green">
              <Icon name="check" size={20} />
            </div>
            <span className="pm-kpi-label">{liveStatus?.label ?? "Active"} Categories</span>
          </div>
          <div className="pm-kpi-value-row">
            <span className="pm-kpi-value">{activeCount}</span>
          </div>
          <div className="pm-kpi-trend-row">
            <span className="pm-badge pm-badge-success">Live</span>
            <span className="pm-kpi-subtitle">Live in Marketplace</span>
          </div>
        </div>

        <div className="pm-kpi-card pm-kpi-tone-purple">
          <div className="pm-kpi-top">
            <div className="pm-kpi-icon pm-kpi-icon-purple">
              <Icon name="list" size={20} />
            </div>
            <span className="pm-kpi-label">Sub-Categories</span>
          </div>
          <div className="pm-kpi-value-row">
            <span className="pm-kpi-value">{totalSubCategories}</span>
          </div>
          <div className="pm-kpi-trend-row">
            <span className="pm-badge pm-badge-neutral">Depth</span>
            <span className="pm-kpi-subtitle">Product Type Mappings</span>
          </div>
        </div>

        <div className="pm-kpi-card pm-kpi-tone-amber">
          <div className="pm-kpi-top">
            <div className="pm-kpi-icon pm-kpi-icon-amber">
              <Icon name="package" size={20} />
            </div>
            <span className="pm-kpi-label">Products Catalog</span>
          </div>
          <div className="pm-kpi-value-row">
            <span className="pm-kpi-value">{totalProducts}</span>
          </div>
          <div className="pm-kpi-trend-row">
            <span className="pm-badge pm-badge-warning">Catalog</span>
            <span className="pm-kpi-subtitle">Total Linked Products</span>
          </div>
        </div>
      </div>

      <div className="pm-filter-bar pm-categories-filter-bar">
        <div className="pm-search-input">
          <Icon name="search" size={16} />
          <input
            placeholder="Search categories..."
            value={searchTerm}
            onChange={(e) => {
              setSearchTerm(e.target.value);
              setCurrentPage(1);
            }}
          />
          {searchTerm && (
            <button className="pm-hero-clear-btn" onClick={() => setSearchTerm("")} title="Clear search">
              <Icon name="close" size={14} />
            </button>
          )}
        </div>

        <CustomSelect
          options={[
            { value: "", label: "All Status" },
            ...categoryStatuses.map((s) => ({ value: s.value, label: s.label })),
          ]}
          value={statusFilter}
          onChange={(val) => {
            setStatusFilter(val);
            setCurrentPage(1);
          }}
          placeholder="All Status"
        />

        <div className="pm-page-size-picker">
          <span className="pm-filter-label">Show:</span>
          <select
            className="pm-select pm-select-sm"
            value={pageSizeOption}
            onChange={(e) => {
              setPageSizeOption(e.target.value);
              setCurrentPage(1);
            }}
          >
            <option value="5">5</option>
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="all">All</option>
            <option value="custom">Custom</option>
          </select>
          {pageSizeOption === "custom" && (
            <input
              type="number"
              min={1}
              max={100}
              className="pm-input pm-custom-page-size-input"
              value={customPageSize}
              onChange={(e) => {
                const val = Math.max(1, parseInt(e.target.value, 10) || 1);
                setCustomPageSize(val);
                setCurrentPage(1);
              }}
              title="Custom quantity"
              placeholder="Qty"
            />
          )}
        </div>

        {(statusFilter || searchTerm || pageSizeOption !== "10") && (
          <button
            className="pm-btn pm-btn-outline"
            onClick={() => {
              setStatusFilter("");
              setSearchTerm("");
              setPageSizeOption("10");
              setCurrentPage(1);
            }}
          >
            <Icon name="filter-x" size={14} /> Reset Filters
          </button>
        )}
      </div>

      <div className="pm-card pm-categories-table-card">
        {loading ? (
          <LoadingSkeletonRows />
        ) : error ? (
          <ErrorState message={error} onRetry={fetchAll} />
        ) : filtered.length === 0 ? (
          <EmptyState icon="grid" title="No categories found" description="Try a different search term or add a new category." />
        ) : (
          <>
            <div className="pm-table-wrap">
              <table className="pm-table">
                <thead>
                  <tr>
                    <th>Category Name</th>
                    <th>Description</th>
                    <th>Sub-Categories</th>
                    <th>Products</th>
                    <th>Status</th>
                    <th>ORDER</th>
                    <th>Created On</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {displayedCategories.map((c) => (
                    <tr key={c.id}>
                      <td>
                        <div className="pm-cat-name-cell">
                          <div className="pm-cat-icon-squircle">
                            <Icon name={(c.iconKey as never) || "grid"} size={16} />
                          </div>
                          <strong
                            style={{ cursor: "pointer", color: "#2563eb" }}
                            onClick={() => open("category-details", { categoryId: c.id })}
                            title="View category details"
                          >
                            {c.name}
                          </strong>
                        </div>
                      </td>
                      <td className="pm-text-muted" style={{ maxWidth: 260 }}>
                        {c.description}
                      </td>
                      <td>
                        <span className="pm-badge pm-badge-neutral">{c.subCategoryCount}</span>
                      </td>
                      <td>
                        <span className="pm-badge pm-badge-info">{c.totalProductCount} products</span>
                      </td>
                      <td>
                        <StatusBadge status={c.status} entityType="Category" />
                      </td>
                      <td>
                        <div className="pm-sort-order-cell">
                          <input
                            type="number"
                            min={1}
                            className="pm-input pm-order-num-input"
                            value={orderValues[c.id] !== undefined ? orderValues[c.id] : c.displayOrder}
                            onChange={(e) => handleOrderChange(c.id, e.target.value)}
                            onBlur={() => handleOrderSubmit(c)}
                            onKeyDown={(e) => {
                              if (e.key === "Enter") {
                                e.currentTarget.blur();
                              }
                            }}
                            title="Edit display order"
                          />
                        </div>
                      </td>
                      <td>{formatDate(c.createdAt)}</td>
                      <td>
                        <div className="pm-row-actions">
                          <button
                            className="pm-icon-btn"
                            onClick={() => open("category-details", { categoryId: c.id })}
                            title="View category"
                          >
                            <Icon name="eye" size={14} />
                          </button>
                          {canEdit && (
                            <>
                              <button
                                className="pm-icon-btn pm-icon-btn-edit"
                                onClick={() => open("category-form", { categoryId: c.id })}
                                title="Edit category"
                              >
                                <Icon name="edit" size={14} />
                              </button>
                            </>
                          )}
                          {canDelete && (
                            <button
                              className="pm-icon-btn pm-icon-btn-delete"
                              onClick={() => {
                                setDeleteTarget(c);
                                setDeleteError(null);
                              }}
                              title="Delete category"
                            >
                              <Icon name="trash" size={14} />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <Pagination
              page={validCurrentPage}
              total={filtered.length}
              pageSize={pageSizeNum || Math.max(1, filtered.length)}
              onPageChange={setCurrentPage}
              itemLabel="category"
            />
          </>
        )}
      </div>

      <ConfirmModal
        isOpen={!!deleteTarget}
        title="Delete Category"
        message="Are you sure you want to permanently delete this category? Categories with linked active products cannot be deleted."
        entityName={deleteTarget?.name}
        details={deleteTarget ? [
          { label: "Category Name", value: deleteTarget.name },
          { label: "Products Linked", value: `${deleteTarget.productCount} products` },
          { label: "Sub-Categories", value: `${deleteTarget.subCategoryCount} types` },
          { label: "Current Status", value: deleteTarget.status },
          { label: "Display Order", value: `#${deleteTarget.displayOrder}` },
          { label: "Created Date", value: formatDate(deleteTarget.createdAt) },
        ] : undefined}
        confirmText="Delete Category"
        variant="danger"
        isLoading={isDeleting}
        errorMessage={deleteError}
        secondaryAction={
          deleteTarget && deleteTarget.status !== "Inactive"
            ? {
                label: "Deactivate Instead",
                variant: "warning",
                onClick: async () => {
                  if (!deleteTarget) return;
                  try {
                    await updateCategory(deleteTarget.id, {
                      name: deleteTarget.name,
                      description: deleteTarget.description || "",
                      iconKey: deleteTarget.iconKey || "",
                      status: "Inactive",
                      displayOrder: deleteTarget.displayOrder,
                    });
                    useToastStore.getState().success("Category Deactivated", `"${deleteTarget.name}" status updated to Inactive.`);
                    setDeleteTarget(null);
                    setDeleteError(null);
                  } catch (err) {
                    if (isApprovalPending(err)) return;
                    setDeleteError((err as Error).message);
                  }
                },
              }
            : undefined
        }
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={handleConfirmDelete}
      />
    </>
  );
}


