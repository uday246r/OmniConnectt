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
import { categoryApi } from '../../services/categoryApi';
import { isApprovalPending } from '../../services/httpClient';
import { useCatalogOptionsStore } from '../../stores/useCatalogOptionsStore';
import { useCatalogSummaryStore } from '../../stores/useCatalogSummaryStore';
import { useCategoryStore } from '../../stores/useCategoryStore';
import { useStatusOptions } from '../../stores/useStatusConfigStore';
import { useToastStore } from '../../stores/useToastStore';
import type { Category } from '../../types/domain';
import { CategoryFormDrawer } from './CategoryFormDrawer';
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

const PAGE_SIZE_KEY = 'products.categories';

export function CategoriesPage() {
  const { items, totalCount, query, loading, loaded, error } = useCategoryStore(
    useShallow((s) => ({ items: s.items, totalCount: s.totalCount, query: s.query, loading: s.loading, loaded: s.loaded, error: s.error })),
  );
  const fetch = useCategoryStore((s) => s.fetch);
  const setQuery = useCategoryStore((s) => s.setQuery);
  const resetQuery = useCategoryStore((s) => s.resetQuery);
  const invalidateOptions = useCatalogOptionsStore((s) => s.invalidate);
  const summary = useCatalogSummaryStore((s) => s.summary);
  const loadSummary = useCatalogSummaryStore((s) => s.load);
  const summaryLoading = useCatalogSummaryStore((s) => s.loading);
  const statuses = useStatusOptions('Category', { includeDisabled: true });
  const { has } = usePermissions();

  const [editing, setEditing] = useState<Category | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Category | null>(null);

  useEffect(() => {
    // The page size the person last chose, on any list in this app, as the host's lists do.
    setQuery({ pageSize: readStoredPageSize(PAGE_SIZE_KEY, query.pageSize) });
    void loadSummary();
    // Deliberately once, on mount: setQuery fetches, and re-running on its identity would loop.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const statusOptions = useMemo(() => statuses.map((s) => ({ value: s.value, label: s.label })), [statuses]);
  const canCreate = has(PERMISSIONS.CATEGORIES_CREATE);
  const canEdit = has(PERMISSIONS.CATEGORIES_EDIT);
  const canDelete = has(PERMISSIONS.CATEGORIES_DELETE);

  // Moving a category up or down only means something in the configured order, on the whole list.
  const reorderable = canEdit && query.sort === 'order' && !query.search && !query.status;
  const firstOverall = (index: number) => query.page === 1 && index === 0;
  const lastOverall = (index: number) => (query.page - 1) * query.pageSize + index + 1 >= totalCount;

  /** After a change of our own: the lists and the totals both moved. */
  const refresh = () => {
    invalidateOptions();
    void fetch();
    void loadSummary({ fresh: true });
  };

  /** The Refresh button: ask the server, do not accept the cached answer. */
  const refetch = () => {
    void fetch({ fresh: true });
    void loadSummary({ fresh: true });
  };

  const openForm = (category: Category | null) => {
    setEditing(category);
    setFormOpen(true);
  };

  const reorder = async (category: Category, direction: 'up' | 'down') => {
    try {
      await categoryApi.reorder(category.id, direction);
      refresh();
    } catch (err) {
      useToastStore.getState().danger('Could not reorder', (err as Error).message);
    }
  };

  const menuFor = (category: Category, index: number): RowMenuItem[] => [
    ...(canEdit ? [{ key: 'edit', label: 'Edit', icon: <Icon.Pencil />, onSelect: () => openForm(category) }] : []),
    ...(reorderable
      ? [
          { key: 'up', label: 'Move up', icon: <Icon.ChevronUp />, disabled: firstOverall(index), onSelect: () => void reorder(category, 'up') },
          { key: 'down', label: 'Move down', icon: <Icon.ChevronDown />, disabled: lastOverall(index), onSelect: () => void reorder(category, 'down') },
        ]
      : []),
    ...(canDelete ? [{ key: 'delete', label: 'Delete', icon: <Icon.Trash />, danger: true, onSelect: () => setDeleting(category) }] : []),
  ];

  const filtered = Boolean(query.search || query.status);
  const canReset = filtered || query.sort !== 'order';

  const activeFilters: ActiveFilter[] = [
    query.search && { key: 'search', label: 'Search', value: query.search, onRemove: () => setQuery({ search: '' }) },
    query.status && {
      key: 'status',
      label: 'Status',
      value: statusOptions.find((s) => s.value === query.status)?.label ?? query.status,
      onRemove: () => setQuery({ status: '' }),
    },
  ].filter(Boolean) as ActiveFilter[];

  /* Priority decides what drops out as the screen narrows, instead of the table scrolling sideways:
     the name and the actions never go, the code and status go last, the rest move into the row's own
     expander. */
  const columns: ResponsiveColumn<Category>[] = [
    {
      key: 'name',
      label: 'Category',
      priority: 'always',
      render: (category) => (
        <div className={styles.nameCell}>
          <CatalogIcon iconKey={category.iconKey} />
          <span className={styles.name}>{category.name}</span>
        </div>
      ),
    },
    { key: 'code', label: 'Code', priority: 'high', render: (c) => <span className={styles.mono}>{c.code}</span> },
    { key: 'description', label: 'Description', priority: 'low', clamp: true, render: (c) => c.description || '—' },
    { key: 'status', label: 'Status', priority: 'high', render: (c) => <StatusBadge entityType="Category" value={c.status} /> },
    { key: 'products', label: 'Total products', priority: 'low', render: (c) => <span className={styles.numeric}>{c.productCount}</span> },
    { key: 'created', label: 'Created', priority: 'low', render: (c) => <span className={styles.muted}>{formatDate(c.createdAt)}</span> },
    {
      key: 'actions',
      label: <span className={styles.srOnly}>Actions</span>,
      priority: 'always',
      align: 'right',
      render: (category, index) => {
        const menu = menuFor(category, index);
        return menu.length > 0 ? <RowMenu label={`Actions for ${category.name}`} items={menu} /> : null;
      },
    },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        icon={<Icon.Layers />}
        title="Categories"
        subtitle="Organize your products into categories"
        actions={canCreate ? <Button variant="onHeader" leadingIcon={<Icon.Plus />} onClick={() => openForm(null)}>Add Category</Button> : undefined}
      />

      {/* While the totals load the row holds its place with shape-matched placeholders; if the read
          fails it is left out, because a tile showing the wrong number is worse than no tile. */}
      {summary ? (
        <div className={styles.kpis}>
          <StatTile label="Categories" value={summary.totalCategories.value} icon={<Icon.Layers />} accent="primary" />
          <StatTile label="Sub-categories" value={summary.totalSubCategories.value} icon={<Icon.Package />} accent="violet" />
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
            searchLabel="Search categories"
            searchPlaceholder="Search categories by name, code or description…"
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
          />
        </div>

        <DataTable
          bare
          reserveHeight
          footer={
            <Pagination
              page={query.page}
              pageSize={query.pageSize}
              total={totalCount}
              itemLabel="category"
              itemLabelPlural="categories"
              onPageChange={(page) => setQuery({ page })}
            />
          }
        >
          <ResponsiveRows
            columns={columns}
            rows={items}
            rowKey={(category) => category.id}
            loading={!loaded && loading}
            loadingRows={Math.min(query.pageSize, 8)}
            empty={filtered ? 'No categories match. Try a different search or status.' : 'No categories yet. Add one to start organising your products.'}
          />
        </DataTable>
      </div>

      <CategoryFormDrawer open={formOpen} category={editing} onClose={() => setFormOpen(false)} onSaved={refresh} />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete category?"
        destructive
        confirmLabel="Delete category"
        pendingApproval={isApprovalPending}
        message={
          <>
            <strong>{deleting?.name}</strong> will be removed permanently. To hide it and everything beneath it without deleting anything,
            set its status to one that is not live instead.
          </>
        }
        onConfirm={async () => {
          if (!deleting) return;
          await categoryApi.remove(deleting.id);
          useToastStore.getState().success('Category deleted', `"${deleting.name}" was removed.`);
          refresh();
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
