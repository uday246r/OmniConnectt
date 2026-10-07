import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  Button,
  ConfirmDialog,
  CsvExportError,
  EmptyState,
  FilterBar,
  Icon,
  PageHeader,
  Pagination,
  Select,
  SkeletonBlock,
  StatTile,
  TabPanel,
  Tabs,
  describeTruncation,
  type ActiveFilter,
} from '@omniconnect/ui';
import { ListToolbar } from '../../components/ListToolbar';
import type { RowMenuItem } from '../../components/RowMenu';
import { usePermissions } from '../../permissions/PermissionContext';
import { PERMISSIONS } from '../../permissions/permissions';
import { isApprovalPending } from '../../services/httpClient';
import { downloadServerCsv } from '../../services/exportCsv';
import { productApi } from '../../services/productApi';
import { useCatalogOptionsStore } from '../../stores/useCatalogOptionsStore';
import { useCatalogSummaryStore } from '../../stores/useCatalogSummaryStore';
import { useProductStore } from '../../stores/useProductStore';
import { useStatusOptions } from '../../stores/useStatusConfigStore';
import { useToastStore } from '../../stores/useToastStore';
import type { ProductDetail, ProductListItem, StatusCount } from '../../types/domain';
import { ProductCard } from './ProductCard';
import { ProductDetailsDrawer } from './ProductDetailsDrawer';
import { ProductFormDrawer } from './ProductFormDrawer';
import page from '../page.module.css';
import styles from './products.module.css';

const SORT_OPTIONS = [
  { value: 'newest', label: 'Sort by: Newest first' },
  { value: 'oldest', label: 'Sort by: Oldest first' },
  { value: 'name', label: 'Sort by: Name (A–Z)' },
  { value: '-name', label: 'Sort by: Name (Z–A)' },
  { value: 'primary-metric', label: 'Sort by: Key figure, low to high' },
  { value: '-primary-metric', label: 'Sort by: Key figure, high to low' },
];

const PAGE_SIZES = [6, 12, 24, 48];
const ALL = 'all';
const TABS_ID = 'products-categories';

export function ProductsPage() {
  const { items, totalCount, query, loading, loaded, error } = useProductStore(
    useShallow((s) => ({ items: s.items, totalCount: s.totalCount, query: s.query, loading: s.loading, loaded: s.loaded, error: s.error })),
  );
  const fetch = useProductStore((s) => s.fetch);
  const setQuery = useProductStore((s) => s.setQuery);
  const resetQuery = useProductStore((s) => s.resetQuery);
  const categories = useCatalogOptionsStore((s) => s.categories);
  const subCategoriesByCategory = useCatalogOptionsStore((s) => s.subCategoriesByCategory);
  const loadCategories = useCatalogOptionsStore((s) => s.loadCategories);
  const loadSubCategories = useCatalogOptionsStore((s) => s.loadSubCategories);
  const summary = useCatalogSummaryStore((s) => s.summary);
  const loadSummary = useCatalogSummaryStore((s) => s.load);
  const statuses = useStatusOptions('Product');
  const { has } = usePermissions();

  const [statusCounts, setStatusCounts] = useState<StatusCount[]>([]);
  const [editing, setEditing] = useState<ProductListItem | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [viewingId, setViewingId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ProductListItem | null>(null);
  const [exporting, setExporting] = useState(false);

  const canCreate = has(PERMISSIONS.PRODUCTS_CREATE);
  const canEdit = has(PERMISSIONS.PRODUCTS_EDIT);
  const canDelete = has(PERMISSIONS.PRODUCTS_DELETE);
  const canExport = has(PERMISSIONS.PRODUCTS_EXPORT);

  useEffect(() => {
    void fetch();
    void loadCategories();
    void loadSummary();
  }, [fetch, loadCategories, loadSummary]);

  useEffect(() => {
    if (query.categoryId) void loadSubCategories(query.categoryId);
  }, [query.categoryId, loadSubCategories]);

  // The status filter shows how many products each status holds under the *other* filters.
  const { search, categoryId, subCategoryId } = query;
  useEffect(() => {
    const controller = new AbortController();
    productApi
      .statusCounts({ search, categoryId, subCategoryId, status: '', sort: '' }, controller.signal)
      .then(setStatusCounts)
      .catch(() => undefined);
    return () => controller.abort();
  }, [search, categoryId, subCategoryId, totalCount]);

  const refresh = () => {
    void fetch();
    void loadCategories({ force: true });
    void loadSummary({ fresh: true });
  };

  /** The Refresh button: ask the server, do not accept the briefly-cached answer. */
  const refetch = () => {
    void fetch({ fresh: true });
    void loadSummary({ fresh: true });
  };

  const tabs = useMemo(() => {
    const all = categories.reduce((sum, c) => sum + c.productCount, 0);
    const count = (n: number) => <span className={styles.count}>{n}</span>;
    return [{ key: ALL, label: 'All products', suffix: count(all) }, ...categories.map((c) => ({ key: c.id, label: c.name, suffix: count(c.productCount) }))];
  }, [categories]);
  const activeTab = query.categoryId || ALL;

  const statusOptions = useMemo(() => {
    const counts = new Map(statusCounts.map((c) => [c.status, c.count]));
    return statuses.map((s) => ({ value: s.value, label: `${s.label} (${counts.get(s.value) ?? 0})` }));
  }, [statuses, statusCounts]);
  const subCategoryOptions = useMemo(
    () => (subCategoriesByCategory[query.categoryId] ?? []).map((s) => ({ value: s.id, label: s.name })),
    [subCategoriesByCategory, query.categoryId],
  );

  const openForm = (product: ProductListItem | null) => {
    setEditing(product);
    setFormOpen(true);
  };

  const changeStatus = async (product: ProductListItem, status: string, label: string) => {
    try {
      await productApi.updateStatus(product.id, status);
      useToastStore.getState().success('Status changed', `"${product.name}" is now ${label}.`);
      refresh();
    } catch (err) {
      if (!isApprovalPending(err)) useToastStore.getState().danger('Could not change the status', (err as Error).message);
    }
  };

  const menuFor = (product: ProductListItem): RowMenuItem[] => [
    // One entry per status Setup offers, so the choices are whatever the administrator has defined.
    ...(canEdit
      ? statuses.filter((s) => s.value !== product.status).map((s) => ({ key: `status-${s.value}`, label: `Set to ${s.label}`, icon: <Icon.Activity />, onSelect: () => void changeStatus(product, s.value, s.label) }))
      : []),
    ...(canDelete ? [{ key: 'delete', label: 'Delete', icon: <Icon.Trash />, danger: true, onSelect: () => setDeleting(product) }] : []),
  ];

  const download = async () => {
    setExporting(true);
    try {
      const result = await downloadServerCsv('/products/export', { search, categoryId, subCategoryId, status: query.status, sort: query.sort }, `products-${new Date().toISOString().slice(0, 10)}.csv`);
      const truncation = describeTruncation(result);
      if (truncation) useToastStore.getState().warning('Download limited', truncation);
    } catch (err) {
      useToastStore.getState().danger('Download failed', err instanceof CsvExportError ? err.message : 'The product list could not be downloaded.');
    } finally {
      setExporting(false);
    }
  };

  const filtered = Boolean(query.search || query.status || query.categoryId || query.subCategoryId);
  const canReset = filtered || query.sort !== 'newest';

  const activeFilters: ActiveFilter[] = [
    query.search && { key: 'search', label: 'Search', value: query.search, onRemove: () => setQuery({ search: '' }) },
    // The category is also the active tab, so removing the chip moves the tabs back to All products.
    query.categoryId && {
      key: 'category',
      label: 'Category',
      value: categories.find((c) => c.id === query.categoryId)?.name ?? query.categoryId,
      onRemove: () => setQuery({ categoryId: '', subCategoryId: '' }),
    },
    query.subCategoryId && {
      key: 'subCategory',
      label: 'Sub-category',
      value: subCategoryOptions.find((s) => s.value === query.subCategoryId)?.label ?? query.subCategoryId,
      onRemove: () => setQuery({ subCategoryId: '' }),
    },
    query.status && {
      key: 'status',
      label: 'Status',
      value: statuses.find((s) => s.value === query.status)?.label ?? query.status,
      onRemove: () => setQuery({ status: '' }),
    },
  ].filter(Boolean) as ActiveFilter[];

  return (
    <div className={page.page}>
      <PageHeader
        icon={<Icon.Package />}
        title="Products"
        subtitle="Manage the products in your catalogue"
        actions={
          <>
            {canExport && <Button variant="onHeader" leadingIcon={<Icon.Download />} onClick={() => void download()} disabled={exporting}>{exporting ? 'Downloading…' : 'Download CSV'}</Button>}
            {canCreate && <Button variant="onHeader" leadingIcon={<Icon.Plus />} onClick={() => openForm(null)}>Add Product</Button>}
          </>
        }
      />

      {/* Counted on the server, not from the rows on screen: these must not change when you page. */}
      {summary && (
        <div className={page.kpis}>
          <StatTile
            label="Products"
            value={summary.totalProducts.value}
            icon={<Icon.Package />}
            accent="primary"
            changePercent={summary.totalProducts.changePercent}
            changeLabel={`vs previous ${summary.comparedDays} days`}
          />
          <StatTile
            label="Live"
            value={summary.liveProducts.value}
            icon={<Icon.CheckCircle />}
            accent="success"
            changePercent={summary.liveProducts.changePercent}
            changeLabel={`vs previous ${summary.comparedDays} days`}
          />
          <StatTile
            label="Not published"
            value={summary.unpublishedProducts.value}
            icon={<Icon.Eye />}
            accent="warning"
            caption="Not on the catalogue"
          />
          <StatTile label="Categories" value={summary.totalCategories.value} icon={<Icon.Layers />} accent="info" />
        </div>
      )}

      <FilterBar filters={activeFilters} onClearAll={resetQuery} />

      <div className={styles.tabs}>
        <Tabs
          id={TABS_ID}
          tabs={tabs}
          activeKey={activeTab}
          onChange={(key) => setQuery({ categoryId: key === ALL ? '' : key, subCategoryId: '' })}
        />
      </div>

      {error && (
        <div role="alert" className={page.error}>
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={refetch}>Try again</Button>
        </div>
      )}

      {/* One card holds the toolbar, the grid and the pager — the frame every other list on the
          platform uses. The pager used to sit in a card of its own below the grid: a card whose only
          content was a footer with a border-top and no body. */}
      <div className={page.card} aria-busy={loading}>
        <div className={page.toolbar}>
          <ListToolbar
            searchLabel="Search products"
            searchPlaceholder="Search products by name, code or description…"
            search={query.search}
            onSearchChange={(value) => setQuery({ search: value })}
            statusOptions={statusOptions}
            status={query.status}
            onStatusChange={(status) => setQuery({ status })}
            sortOptions={SORT_OPTIONS}
            sort={query.sort}
            onSortChange={(sort) => setQuery({ sort })}
            canReset={canReset}
            onReset={resetQuery}
            trailing={
              <Button
                variant="secondary"
                size="sm"
                leadingIcon={<Icon.Activity width={15} height={15} />}
                disabled={loading}
                onClick={refetch}
              >
                Refresh
              </Button>
            }
          >
            <div className={page.filterControl}>
              <Select
                aria-label="Filter by sub-category"
                options={subCategoryOptions}
                value={query.subCategoryId}
                placeholder={query.categoryId ? 'All sub-categories' : 'Choose a category first'}
                clearLabel="All sub-categories"
                disabled={!query.categoryId}
                onChange={(e) => setQuery({ subCategoryId: e.target.value })}
              />
            </div>
          </ListToolbar>
        </div>

        <TabPanel id={TABS_ID} tabId={activeTab} active>
          <div className={page.cardBody}>
            {!loaded && loading ? (
              <div className={styles.grid}>
                {Array.from({ length: 6 }, (_, i) => <SkeletonBlock key={i} width="100%" height={280} radius="14px" />)}
              </div>
            ) : items.length === 0 ? (
              <EmptyState
                icon={<Icon.Package />}
                title={filtered ? 'No products match' : 'No products yet'}
                description={filtered ? 'Try a different search, category or status.' : 'Add your first product to start building the catalogue.'}
                action={filtered ? <Button variant="secondary" onClick={resetQuery}>Reset filters</Button> : canCreate ? <Button onClick={() => openForm(null)}>Add Product</Button> : undefined}
              />
            ) : (
              <div className={styles.grid}>
                {items.map((product) => (
                  <ProductCard key={product.id} product={product} onView={() => setViewingId(product.id)} onEdit={canEdit ? () => openForm(product) : undefined} menu={menuFor(product)} />
                ))}
              </div>
            )}
          </div>
        </TabPanel>

        <div className={page.footer}>
          <Pagination
            page={query.page}
            pageSize={query.pageSize}
            total={totalCount}
            itemLabel="products"
            pageSizeOptions={PAGE_SIZES}
            onPageChange={(p) => setQuery({ page: p })}
            onPageSizeChange={(pageSize) => setQuery({ pageSize, page: 1 })}
          />
        </div>
      </div>

      <ProductFormDrawer
        open={formOpen}
        product={editing}
        defaultCategoryId={query.categoryId || undefined}
        defaultSubCategoryId={query.subCategoryId || undefined}
        onClose={() => setFormOpen(false)}
        onSaved={refresh}
      />

      <ProductDetailsDrawer
        productId={viewingId}
        onClose={() => setViewingId(null)}
        onEdit={
          canEdit
            ? (detail: ProductDetail) => {
                setViewingId(null);
                openForm(items.find((p) => p.id === detail.id) ?? detail);
              }
            : undefined
        }
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete product?"
        destructive
        confirmLabel="Delete product"
        pendingApproval={isApprovalPending}
        message={
          <>
            <strong>{deleting?.name}</strong> will be removed permanently. To take it off the catalogue without deleting it, change its
            status to one that is not live instead.
          </>
        }
        onConfirm={async () => {
          if (!deleting) return;
          await productApi.remove(deleting.id);
          useToastStore.getState().success('Product deleted', `"${deleting.name}" was removed.`);
          refresh();
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
