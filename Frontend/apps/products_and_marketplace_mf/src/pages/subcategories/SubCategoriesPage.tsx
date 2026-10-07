import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  Button,
  ConfirmDialog,
  DataTable,
  FilterBar,
  Icon,
  PageHeader,
  Pagination,
  ResponsiveRows,
  RowsPerPage,
  Select,
  StatTile,
  formatDate,
  readStoredPageSize,
  type ActiveFilter,
  type ResponsiveColumn,
  StatTileSkeleton,
} from '@omniconnect/ui';
import { CatalogIcon } from '../../components/CatalogIcon';
import { ListToolbar } from '../../components/ListToolbar';
import { RowMenu, type RowMenuItem } from '../../components/RowMenu';
import { StatusBadge } from '../../components/StatusBadge';
import { usePermissions } from '../../permissions/PermissionContext';
import { PERMISSIONS } from '../../permissions/permissions';
import { subCategoryApi } from '../../services/subCategoryApi';
import { isApprovalPending } from '../../services/httpClient';
import { useCatalogOptionsStore } from '../../stores/useCatalogOptionsStore';
import { useCatalogSummaryStore } from '../../stores/useCatalogSummaryStore';
import { useStatusOptions } from '../../stores/useStatusConfigStore';
import { useSubCategoryStore } from '../../stores/useSubCategoryStore';
import { useToastStore } from '../../stores/useToastStore';
import type { SubCategory } from '../../types/domain';
import { SubCategoryFormDrawer } from './SubCategoryFormDrawer';
import styles from '../page.module.css';

const SORT_OPTIONS = [
  { value: 'order', label: 'Sort by: Display order' },
  { value: 'name', label: 'Sort by: Name (A–Z)' },
  { value: '-name', label: 'Sort by: Name (Z–A)' },
  { value: '-created', label: 'Sort by: Newest first' },
  { value: 'created', label: 'Sort by: Oldest first' },
  { value: '-products', label: 'Sort by: Most products' },
  { value: 'products', label: 'Sort by: Fewest products' },
];

const PAGE_SIZE_KEY = 'products.sub-categories';

export function SubCategoriesPage() {
  const { items, totalCount, query, loading, loaded, error } = useSubCategoryStore(
    useShallow((s) => ({ items: s.items, totalCount: s.totalCount, query: s.query, loading: s.loading, loaded: s.loaded, error: s.error })),
  );
  const fetch = useSubCategoryStore((s) => s.fetch);
  const setQuery = useSubCategoryStore((s) => s.setQuery);
  const resetQuery = useSubCategoryStore((s) => s.resetQuery);
  const categories = useCatalogOptionsStore((s) => s.categories);
  const loadCategories = useCatalogOptionsStore((s) => s.loadCategories);
  const invalidateOptions = useCatalogOptionsStore((s) => s.invalidate);
  const summary = useCatalogSummaryStore((s) => s.summary);
  const loadSummary = useCatalogSummaryStore((s) => s.load);
  const summaryLoading = useCatalogSummaryStore((s) => s.loading);
  const statuses = useStatusOptions('SubCategory', { includeDisabled: true });
  const { has } = usePermissions();

  const [editing, setEditing] = useState<SubCategory | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<SubCategory | null>(null);

  useEffect(() => {
    setQuery({ pageSize: readStoredPageSize(PAGE_SIZE_KEY, query.pageSize) });
    void loadCategories();
    void loadSummary();
    // Deliberately once, on mount: setQuery fetches, and re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusOptions = useMemo(() => statuses.map((s) => ({ value: s.value, label: s.label })), [statuses]);
  const categoryOptions = useMemo(() => categories.map((c) => ({ value: c.id, label: c.name })), [categories]);
  const canCreate = has(PERMISSIONS.SUBCATEGORIES_CREATE);
  const canEdit = has(PERMISSIONS.SUBCATEGORIES_EDIT);
  const canDelete = has(PERMISSIONS.SUBCATEGORIES_DELETE);

  // Display order is kept within one category, so moving a row only means something once the list is
  // narrowed to a single category, in the configured order.
  const reorderable = canEdit && Boolean(query.categoryId) && query.sort === 'order' && !query.search && !query.status;
  const firstOverall = (index: number) => query.page === 1 && index === 0;
  const lastOverall = (index: number) => (query.page - 1) * query.pageSize + index + 1 >= totalCount;

  const refresh = () => {
    invalidateOptions();
    void fetch();
    void loadCategories({ force: true });
    void loadSummary({ fresh: true });
  };

  /** The Refresh button: ask the server, do not accept the cached answer. */
  const refetch = () => {
    void fetch({ fresh: true });
    void loadSummary({ fresh: true });
  };

  const openForm = (subCategory: SubCategory | null) => {
    setEditing(subCategory);
    setFormOpen(true);
  };

  const reorder = async (subCategory: SubCategory, direction: 'up' | 'down') => {
    try {
      await subCategoryApi.reorder(subCategory.id, direction);
      refresh();
    } catch (err) {
      useToastStore.getState().danger('Could not reorder', (err as Error).message);
    }
  };

  const menuFor = (subCategory: SubCategory, index: number): RowMenuItem[] => [
    ...(canEdit ? [{ key: 'edit', label: 'Edit', icon: <Icon.Pencil />, onSelect: () => openForm(subCategory) }] : []),
    ...(reorderable
      ? [
          { key: 'up', label: 'Move up', icon: <Icon.ChevronUp />, disabled: firstOverall(index), onSelect: () => void reorder(subCategory, 'up') },
          { key: 'down', label: 'Move down', icon: <Icon.ChevronDown />, disabled: lastOverall(index), onSelect: () => void reorder(subCategory, 'down') },
        ]
      : []),
    ...(canDelete ? [{ key: 'delete', label: 'Delete', icon: <Icon.Trash />, danger: true, onSelect: () => setDeleting(subCategory) }] : []),
  ];

  const filtered = Boolean(query.search || query.status || query.categoryId);
  const canReset = filtered || query.sort !== 'order';

  const activeFilters: ActiveFilter[] = [
    query.search && { key: 'search', label: 'Search', value: query.search, onRemove: () => setQuery({ search: '' }) },
    query.categoryId && {
      key: 'category',
      label: 'Category',
      value: categoryOptions.find((c) => c.value === query.categoryId)?.label ?? query.categoryId,
      onRemove: () => setQuery({ categoryId: '' }),
    },
    query.status && {
      key: 'status',
      label: 'Status',
      value: statusOptions.find((s) => s.value === query.status)?.label ?? query.status,
      onRemove: () => setQuery({ status: '' }),
    },
  ].filter(Boolean) as ActiveFilter[];

  const columns: ResponsiveColumn<SubCategory>[] = [
    {
      key: 'name',
      label: 'Sub-category',
      priority: 'always',
      render: (subCategory) => (
        <div className={styles.nameCell}>
          <CatalogIcon iconKey={subCategory.iconKey} />
          <span className={styles.name}>{subCategory.name}</span>
        </div>
      ),
    },
    { key: 'code', label: 'Code', priority: 'low', render: (s) => <span className={styles.mono}>{s.code}</span> },
    { key: 'category', label: 'Category', priority: 'high', render: (s) => <span className={styles.muted}>{s.categoryName}</span> },
    { key: 'description', label: 'Description', priority: 'low', clamp: true, render: (s) => s.description || '—' },
    { key: 'status', label: 'Status', priority: 'high', render: (s) => <StatusBadge entityType="SubCategory" value={s.status} /> },
    { key: 'products', label: 'Total products', priority: 'low', render: (s) => <span className={styles.numeric}>{s.productCount}</span> },
    { key: 'created', label: 'Created', priority: 'low', render: (s) => <span className={styles.muted}>{formatDate(s.createdAt)}</span> },
    {
      key: 'actions',
      label: <span className={styles.srOnly}>Actions</span>,
      priority: 'always',
      align: 'right',
      render: (subCategory, index) => {
        const menu = menuFor(subCategory, index);
        return menu.length > 0 ? <RowMenu label={`Actions for ${subCategory.name}`} items={menu} /> : null;
      },
    },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        icon={<Icon.Layers />}
        title="Sub-categories"
        subtitle="Manage the types of product within each category"
        actions={canCreate ? <Button variant="onHeader" leadingIcon={<Icon.Plus />} onClick={() => openForm(null)}>Add Sub-category</Button> : undefined}
      />

      {summary ? (
        <div className={styles.kpis}>
          <StatTile label="Sub-categories" value={summary.totalSubCategories.value} icon={<Icon.Package />} accent="primary" />
          <StatTile label="Categories" value={summary.totalCategories.value} icon={<Icon.Layers />} accent="violet" />
          <StatTile label="Products in catalogue" value={summary.totalProducts.value} icon={<Icon.Box />} accent="success" />
        </div>
      ) : summaryLoading ? (
        <div className={styles.kpis} aria-hidden="true">
          <StatTileSkeleton />
          <StatTileSkeleton />
          <StatTileSkeleton />
        </div>
      ) : null}

      <FilterBar filters={activeFilters} onClearAll={resetQuery} />

      {error && (
        <div role="alert" className={styles.error}>
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={refetch}>Try again</Button>
        </div>
      )}

      <div className={styles.card} aria-busy={loading}>
        <div className={styles.toolbar}>
          <ListToolbar
            searchLabel="Search sub-categories"
            searchPlaceholder="Search sub-categories by name, code, description or category…"
            search={query.search}
            onSearchChange={(search) => setQuery({ search })}
            statusOptions={statusOptions}
            status={query.status}
            onStatusChange={(status) => setQuery({ status })}
            sortOptions={SORT_OPTIONS}
            sort={query.sort}
            onSortChange={(sort) => setQuery({ sort })}
            canReset={canReset}
            onReset={resetQuery}
            trailing={
              <>
                <RowsPerPage
                  storageKey={PAGE_SIZE_KEY}
                  value={query.pageSize}
                  onChange={(pageSize) => setQuery({ pageSize, page: 1 })}
                />
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={<Icon.Activity width={15} height={15} />}
                  disabled={loading}
                  onClick={refetch}
                >
                  Refresh
                </Button>
              </>
            }
          >
            <div className={styles.filterControl}>
              <Select
                aria-label="Filter by category"
                options={categoryOptions}
                value={query.categoryId}
                placeholder="All categories"
                clearLabel="All categories"
                onChange={(e) => setQuery({ categoryId: e.target.value })}
              />
            </div>
          </ListToolbar>
        </div>

        <DataTable
          bare
          reserveHeight
          footer={
            <Pagination
              page={query.page}
              pageSize={query.pageSize}
              total={totalCount}
              itemLabel="sub-category"
              itemLabelPlural="sub-categories"
              onPageChange={(page) => setQuery({ page })}
            />
          }
        >
          <ResponsiveRows
            columns={columns}
            rows={items}
            rowKey={(subCategory) => subCategory.id}
            loading={!loaded && loading}
            loadingRows={Math.min(query.pageSize, 8)}
            empty={
              filtered
                ? 'No sub-categories match. Try a different search, category or status.'
                : 'No sub-categories yet. Add one — a type of product, like Home Loan — under a category.'
            }
          />
        </DataTable>
      </div>

      <SubCategoryFormDrawer
        open={formOpen}
        subCategory={editing}
        defaultCategoryId={query.categoryId || undefined}
        onClose={() => setFormOpen(false)}
        onSaved={refresh}
      />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete sub-category?"
        destructive
        confirmLabel="Delete sub-category"
        pendingApproval={isApprovalPending}
        message={
          <>
            <strong>{deleting?.name}</strong> will be removed permanently, along with the attributes defined for its products. To hide it
            and its products without deleting anything, set its status to one that is not live instead.
          </>
        }
        onConfirm={async () => {
          if (!deleting) return;
          await subCategoryApi.remove(deleting.id);
          useToastStore.getState().success('Sub-category deleted', `"${deleting.name}" was removed.`);
          refresh();
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
