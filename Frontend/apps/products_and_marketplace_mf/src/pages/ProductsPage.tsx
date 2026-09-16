import { isApprovalPending } from "../services/httpClient";
import { useState, useEffect } from "react";
import { Icon, type IconName } from "../components/common/Icon";
import { ProductCard } from "../components/product/ProductCard";
import { EmptyState, ErrorState, LoadingSkeletonGrid } from "../components/common/EmptyState";
import { ConfirmModal } from "../components/common/ConfirmModal";
import { CustomSelect } from "../components/common/CustomSelect";
import { useProductStore } from "../stores/useProductStore";
import { useCategoryStore } from "../stores/useCategoryStore";
import { useDrawerStore } from "../stores/useDrawerStore";
import { useStatusConfigStore } from "../stores/useStatusConfigStore";
import { useToastStore } from "../stores/useToastStore";
import { usePermissions } from "../permissions/PermissionContext";
import { PERMISSIONS } from "../permissions/permissions";
import { productApi } from "../services/productApi";
import { CsvExportError, describeTruncation, Pagination, Button, PageHeader } from "@omniconnect/ui";
import { downloadServerCsv } from "../services/exportCsv";
import type { ProductStatus, SortOption, TopPerformer } from "../types/domain";
import "./ProductsPage.css";

const SORT_TABS: { value: SortOption; label: string }[] = [
  { value: "recommended", label: "Recommended for You" },
  { value: "trending", label: "Trending Now" },
  { value: "lowest-rate", label: "Lowest Interest" },
  { value: "newly-added", label: "Newly Added" },
  { value: "top-rated", label: "Top Rated" },
];

const CATEGORY_PILL_LIMIT = 6;

export function ProductsPage() {
  const {
    items,
    totalCount,
    page,
    pageSize,
    search,
    categoryId,
    productTypeId,
    status,
    sort,
    loading,
    error,
    productTypes,
    setPage,
    setPageSize,
    setSearch,
    setCategoryId,
    setProductTypeId,
    setStatus,
    setSort,
    resetFilters,
    fetchProducts,
    fetchProductTypes,
    updateStatus,
    removeProduct,
  } = useProductStore();
  const { categories, fetchAll: fetchCategories } = useCategoryStore();
  const { open } = useDrawerStore();
  const { configs: statusConfigs, fetchAll: fetchStatusConfigs } = useStatusConfigStore();
  const { has } = usePermissions();

  const [searchInput, setSearchInput] = useState(search);
  const [statusCounts, setStatusCounts] = useState<Record<string, number>>({});
  const [showMoreCategories, setShowMoreCategories] = useState(false);
  const [pageSizeOption, setPageSizeOption] = useState<string>("8");
  const [customPageSize, setCustomPageSize] = useState<number>(12);

  const productStatuses = statusConfigs
    .filter((c) => c.entityType === "Product" && c.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const statusOptions = [
    { label: "All Status", value: "" },
    ...productStatuses.map((s) => ({ label: s.label, value: s.value })),
  ];

  const [deleteTarget, setDeleteTarget] = useState<typeof items[0] | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  useEffect(() => {
    fetchCategories();
    fetchProductTypes();
    fetchStatusConfigs();
  }, [fetchCategories, fetchProductTypes, fetchStatusConfigs]);

  useEffect(() => {
    fetchProducts();
  }, [search, categoryId, productTypeId, status, sort, page, pageSize, fetchProducts]);

  function handlePageSizeChange(opt: string) {
    setPageSizeOption(opt);
    if (opt === "all") {
      setPageSize(100);
    } else if (opt === "custom") {
      setPageSize(customPageSize || 8);
    } else {
      setPageSize(parseInt(opt, 10) || 8);
    }
    setPage(1);
  }

  useEffect(() => {
    setSearchInput(search);
  }, [search]);

  useEffect(() => {
    Promise.all(
      statusOptions.map((t) => productApi.search({ status: (t.value as ProductStatus) || undefined, categoryId: categoryId || undefined, pageSize: 1 }))
    ).then((results) => {
      const counts: Record<string, number> = {};
      statusOptions.forEach((t, i) => (counts[t.value || "All"] = results[i].totalCount));
      setStatusCounts(counts);
    });
  }, [categoryId, items, statusConfigs]);

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput), 350);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  const canManage = has(PERMISSIONS.PRODUCTS_EDIT);
  const canCreate = has(PERMISSIONS.PRODUCTS_CREATE);
  const canApply = has(PERMISSIONS.PRODUCTS_APPLY);
  const canDelete = has(PERMISSIONS.PRODUCTS_DELETE);

  async function handleMenuAction(productId: string, action: "edit" | "activate" | "deactivate" | "delete") {
    if (action === "edit") return open("product-form", { productId });
    if (action === "activate") {
      try {
        await updateStatus(productId, "Active");
        useToastStore.getState().success("Product Activated", "Product status updated to Active.");
      } catch (err) {
        if (isApprovalPending(err)) return;
        useToastStore.getState().danger("Status Update Failed", (err as Error).message);
      }
      return;
    }
    if (action === "deactivate") {
      try {
        await updateStatus(productId, "Inactive");
        useToastStore.getState().success("Product Deactivated", "Product status updated to Inactive.");
      } catch (err) {
        if (isApprovalPending(err)) return;
        useToastStore.getState().danger("Status Update Failed", (err as Error).message);
      }
      return;
    }
    if (action === "delete") {
      if (!canDelete) {
        alert("You do not have permission to delete products.");
        return;
      }
      const prod = items.find((p) => p.id === productId);
      if (prod) {
        setDeleteTarget(prod);
        setDeleteError(null);
      }
    }
  }

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    const name = deleteTarget.name;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await removeProduct(deleteTarget.id);
      setDeleteTarget(null);
      useToastStore.getState().success("Product Deleted", `"${name}" has been deleted successfully.`);
    } catch (err) {
      if (isApprovalPending(err)) return;
      setDeleteError((err as Error).message);
      useToastStore.getState().danger("Delete Failed", (err as Error).message);
    } finally {
      setIsDeleting(false);
    }
  }

  /** Every product matching the filters on screen, built by the server — not just the cards on this page. */
  async function handleExport() {
    const { search, categoryId, productTypeId, status, sort } = useProductStore.getState();
    try {
      const result = await downloadServerCsv(
        "/products/export",
        { search, categoryId, productTypeId, status, sort },
        `products-${new Date().toISOString().slice(0, 10)}.csv`,
      );
      const truncation = describeTruncation(result);
      if (truncation) useToastStore.getState().warning("Download limited", truncation);
    } catch (err) {
      useToastStore.getState().danger("Download failed", err instanceof CsvExportError ? err.message : "The product list could not be downloaded.");
    }
  }

  function handleViewAll() {
    setSearchInput("");
    setShowMoreCategories(false);
    // Keep current sort tab but clear restrictive filters and show all results
    setCategoryId(null);
    setProductTypeId(null);
    setStatus(null);
    setSearch("");
    setPageSize(100);
    setPageSizeOption("all");
    setPage(1);
  }

  const hasFilters = !!(search || categoryId || productTypeId || status);
  const visibleCategories = showMoreCategories ? categories : categories.slice(0, CATEGORY_PILL_LIMIT);
  const hiddenCategoryCount = categories.length - CATEGORY_PILL_LIMIT;

  return (
    <div className="pm-page pm-products-page">
      <PageHeader
        className="pm-products-hero"
        title="Product Marketplace"
        subtitle="Discover, compare, and apply for banking and financial products."
        icon={<Icon name="package" size={24} />}
        actions={
          <div className="pm-hero-right-col">
            {canCreate && (
              <Button variant="onHeader" leadingIcon={<Icon name="plus" size={16} />} onClick={() => open("product-form", {})}>
                Add Product
              </Button>
            )}
            <form
              className="pm-hero-search"
              role="search"
              onSubmit={(e) => {
                e.preventDefault();
                setSearch(searchInput);
              }}
            >
              <Icon name="search" size={16} className="pm-hero-search-icon" />
              <input
                className="pm-input pm-flex-1"
                aria-label="Search products"
                placeholder="Search products, rates, benefits..."
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
              />
              {searchInput && (
                <button type="button" className="pm-hero-clear-btn" onClick={() => setSearchInput("")} aria-label="Clear search" title="Clear search">
                  <Icon name="close" size={14} />
                </button>
              )}
              <button type="submit" className="pm-btn pm-btn-primary">
                Search
              </button>
            </form>
          </div>
        }
      />

      <div className="pm-category-row">
        <button className={`pm-category-pill ${!categoryId ? "active" : ""}`} onClick={() => setCategoryId(null)}>
          <Icon name="grid" size={16} />
          All Products
        </button>
        {visibleCategories.map((c) => (
          <button key={c.id} className={`pm-category-pill ${categoryId === c.id ? "active" : ""}`} onClick={() => setCategoryId(c.id)}>
            <Icon name={c.iconKey as never} size={16} />
            {c.name}
          </button>
        ))}
        {!showMoreCategories && hiddenCategoryCount > 0 && (
          <button className="pm-category-pill" onClick={() => setShowMoreCategories(true)}>
            <Icon name="more-horizontal" size={16} />
            More ({hiddenCategoryCount})
          </button>
        )}
      </div>

      <div className="pm-filter-sort-bar">
        <div className="pm-tabs pm-sort-tabs">
          {SORT_TABS.map((t) => (
            <button key={t.value} className={`pm-tab ${sort === t.value ? "active" : ""}`} onClick={() => setSort(t.value)}>
              {t.label}
            </button>
          ))}
        </div>

        <div className="pm-filter-controls-group">
          <CustomSelect
            options={[
              { value: "", label: "All Product Types" },
              ...productTypes.map((t) => ({ value: t.id, label: t.name })),
            ]}
            value={productTypeId ?? ""}
            onChange={(val) => setProductTypeId(val || null)}
            placeholder="All Product Types"
          />
          <CustomSelect
            options={statusOptions.map((o) => ({
              value: o.value,
              label: `${o.label} (${statusCounts[o.value || "All"] ?? 0})`,
            }))}
            value={status ?? ""}
            onChange={(val) => setStatus(val || null)}
            placeholder="All Status"
          />

          <div className="pm-page-size-picker">
            <span className="pm-filter-label">SHOW:</span>
            <select
              className="pm-select pm-select-sm"
              value={pageSizeOption}
              onChange={(e) => handlePageSizeChange(e.target.value)}
            >
              <option value="6">6</option>
              <option value="12">12</option>
              <option value="24">24</option>
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
                  setPageSize(val);
                  setPage(1);
                }}
                title="Custom quantity"
                placeholder="Qty"
              />
            )}
          </div>

          {hasFilters && (
            <button className="pm-btn pm-btn-outline pm-btn-sm" onClick={() => { resetFilters(); setSearchInput(""); }}>
              <Icon name="filter-x" size={14} /> Reset
            </button>
          )}

          <span className="pm-products-count-tag">
            {totalCount} Products
          </span>

          <button className="pm-btn pm-btn-outline pm-btn-sm" onClick={handleExport} title="Export CSV">
            <Icon name="download" size={14} /> Export
          </button>

          <button className="pm-view-all-link" onClick={handleViewAll}>
            View All <Icon name="chevron-right" size={14} />
          </button>
        </div>
      </div>

      <div className="pm-products-layout">
        <div className="pm-products-main">
          {loading ? (
            <LoadingSkeletonGrid count={pageSize} />
          ) : error ? (
            <ErrorState message={error} onRetry={fetchProducts} />
          ) : items.length === 0 ? (
            <EmptyState
              icon="search"
              title="No products found"
              description="Try adjusting your search or filters to find what you're looking for."
              action={
                hasFilters ? (
                  <button className="pm-btn pm-btn-outline pm-btn-sm" onClick={() => { resetFilters(); setSearchInput(""); }}>
                    Reset Filters
                  </button>
                ) : undefined
              }
            />
          ) : (
            <>
              <div className="pm-product-grid">
                {items.map((product) => (
                  <ProductCard
                    key={product.id}
                    product={product}
                    canApply={canApply}
                    canManage={canManage}
                    sortContext={sort}
                    onViewDetails={() => open("product-details", { productId: product.id })}
                    onApply={() => open("apply-now", { productId: product.id })}
                    onMenuAction={(action) => handleMenuAction(product.id, action)}
                  />
                ))}
              </div>
              <Pagination page={page} total={totalCount} pageSize={pageSize} onPageChange={setPage} itemLabel="product" />
            </>
          )}
        </div>

        <aside className="pm-products-rail">
          <TopPerformersRail />

          <div className="pm-card pm-rail-card">
            <div className="pm-rail-card-head">
              <h3>Popular Categories</h3>
              <button className="pm-view-all-link pm-view-all-link-sm" onClick={handleViewAll}>
                View All
              </button>
            </div>
            <div className="pm-category-tile-grid">
              {categories
                .slice()
                .sort((a, b) => b.productCount - a.productCount)
                .slice(0, 6)
                .map((c) => (
                  <button key={c.id} className="pm-category-tile" onClick={() => setCategoryId(c.id)}>
                    <Icon name={c.iconKey as never} size={18} />
                    <span>{c.name}</span>
                    <span className="pm-text-muted">{c.productCount}+ Products</span>
                  </button>
                ))}
            </div>
          </div>
        </aside>
      </div>

      <ConfirmModal
        isOpen={!!deleteTarget}
        title="Delete Product"
        message="Are you sure you want to permanently delete this product? This action cannot be undone."
        entityName={deleteTarget?.name}
        details={deleteTarget ? [
          { label: "Product Name", value: deleteTarget.name },
          { label: "Product Code", value: deleteTarget.code },
          { label: "Category", value: deleteTarget.categoryName },
          { label: "Product Type", value: deleteTarget.productTypeName },
          { label: "Current Status", value: deleteTarget.status },
          { label: "Applications", value: `${deleteTarget.applicationCount} submitted` },
          { label: "Customer Rating", value: `${deleteTarget.ratingAverage} / 5` },
        ] : undefined}
        confirmText="Delete Product"
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
                    await updateStatus(deleteTarget.id, "Inactive");
                    useToastStore.getState().success("Product Deactivated", `"${deleteTarget.name}" status updated to Inactive.`);
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
    </div>
  );
}

const PERFORMER_TABS: { value: "applied" | "viewed" | "rated"; label: string }[] = [
  { value: "applied", label: "Most Applied" },
  { value: "viewed", label: "Most Viewed" },
  { value: "rated", label: "Highest Rated" },
];

function TopPerformersRail() {
  const { open } = useDrawerStore();
  const [metric, setMetric] = useState<"applied" | "viewed" | "rated">("applied");
  const [performers, setPerformers] = useState<TopPerformer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    productApi
      .topPerformers(metric, 5, controller.signal)
      .then((data) => {
        setPerformers(data);
        setLoading(false);
      })
      .catch(() => setLoading(false));
    return () => controller.abort();
  }, [metric]);

  function metricValue(p: TopPerformer) {
    if (metric === "viewed") return `${p.viewCount.toLocaleString()} Views`;
    if (metric === "rated") return p.ratingCount > 0 ? `${p.ratingAverage.toFixed(1)} ★` : "New";
    return `${p.applicationCount.toLocaleString()} Apps`;
  }

  return (
    <div className="pm-card pm-rail-card">
      <div className="pm-rail-card-head">
        <h3>Top Performers</h3>
      </div>
      <div className="pm-performer-tabs">
        {PERFORMER_TABS.map((t) => (
          <button key={t.value} className={`pm-performer-tab ${metric === t.value ? "active" : ""}`} onClick={() => setMetric(t.value)}>
            {t.label}
          </button>
        ))}
      </div>
      {loading ? (
        <div className="pm-skeleton" style={{ height: 140 }} />
      ) : (
        <ul className="pm-performer-list">
          {performers.map((p, i) => (
            <li key={p.id} onClick={() => open("product-details", { productId: p.id })}>
              <span className="pm-rank-index">{i + 1}</span>
              <div className="pm-rank-icon">
                <Icon name={(p.iconKey as IconName) || "package"} size={16} />
              </div>
              <div className="pm-performer-info">
                <strong title={p.name}>{p.name}</strong>
                <span className="pm-hint">{p.categoryName}</span>
              </div>
              <span className="pm-performer-value">{metricValue(p)}</span>
            </li>
          ))}
          {performers.length === 0 && <p className="pm-hint">No data yet.</p>}
        </ul>
      )}
    </div>
  );
}
