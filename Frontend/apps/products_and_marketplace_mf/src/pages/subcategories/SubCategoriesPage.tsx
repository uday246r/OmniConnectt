import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Button, DataTable, DataTableEmpty, EmptyState, Icon, PageHeader, Pagination, Select, TableSkeleton, formatDate } from '@omniconnect/ui';
import { CatalogIcon } from '../../components/CatalogIcon';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ListToolbar } from '../../components/ListToolbar';
import { RowMenu, type RowMenuItem } from '../../components/RowMenu';
import { StatusBadge } from '../../components/StatusBadge';
import { usePermissions } from '../../permissions/PermissionContext';
import { PERMISSIONS } from '../../permissions/permissions';
import { subCategoryApi } from '../../services/subCategoryApi';
import { useCatalogOptionsStore } from '../../stores/useCatalogOptionsStore';
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

const COLUMNS = 8;

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
  const statuses = useStatusOptions('SubCategory', { includeDisabled: true });
  const { has } = usePermissions();

  const [editing, setEditing] = useState<SubCategory | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<SubCategory | null>(null);

  useEffect(() => {
    void fetch();
    void loadCategories();
  }, [fetch, loadCategories]);

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

  return (
    <div className={styles.page}>
      <PageHeader
        icon={<Icon.Layers />}
        title="Sub-categories"
        subtitle="Manage the types of product within each category"
        actions={canCreate ? <Button variant="onHeader" leadingIcon={<Icon.Plus />} onClick={() => openForm(null)}>Add Sub-category</Button> : undefined}
      />

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
      >
        <div className={styles.control}>
          <Select aria-label="Filter by category" options={categoryOptions} value={query.categoryId} placeholder="All categories" clearLabel="All categories" onChange={(e) => setQuery({ categoryId: e.target.value })} />
        </div>
      </ListToolbar>

      {error && (
        <div role="alert" className={styles.error}>
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={() => void fetch()}>Try again</Button>
        </div>
      )}

      <div className={styles.card} aria-busy={loading}>
        <DataTable minWidth={960}>
          <thead>
            <tr>
              <th scope="col">Sub-category</th>
              <th scope="col">Code</th>
              <th scope="col">Category</th>
              <th scope="col">Description</th>
              <th scope="col">Status</th>
              <th scope="col" className={styles.numeric}>Total products</th>
              <th scope="col">Created</th>
              <th scope="col"><span className={styles.srOnly}>Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {!loaded && loading ? (
              <TableSkeleton rows={Math.min(query.pageSize, 8)} columns={COLUMNS} />
            ) : items.length === 0 ? (
              <DataTableEmpty colSpan={COLUMNS}>
                <EmptyState
                  compact
                  icon={<Icon.Layers />}
                  title={filtered ? 'No sub-categories match' : 'No sub-categories yet'}
                  description={filtered ? 'Try a different search, category or status.' : 'Add a sub-category — a type of product, like Home Loan — under one of your categories.'}
                  action={filtered ? <Button variant="secondary" onClick={resetQuery}>Reset filters</Button> : canCreate ? <Button onClick={() => openForm(null)}>Add Sub-category</Button> : undefined}
                />
              </DataTableEmpty>
            ) : (
              items.map((subCategory, index) => {
                const menu = menuFor(subCategory, index);
                return (
                  <tr key={subCategory.id}>
                    <td>
                      <div className={styles.nameCell}>
                        <CatalogIcon iconKey={subCategory.iconKey} />
                        <span className={styles.name}>{subCategory.name}</span>
                      </div>
                    </td>
                    <td className={styles.mono}>{subCategory.code}</td>
                    <td className={styles.muted}>{subCategory.categoryName}</td>
                    <td className={styles.description}>{subCategory.description || '—'}</td>
                    <td><StatusBadge entityType="SubCategory" value={subCategory.status} /></td>
                    <td className={styles.numeric}>{subCategory.productCount}</td>
                    <td className={styles.muted}>{formatDate(subCategory.createdAt)}</td>
                    <td className={styles.actions}>{menu.length > 0 && <RowMenu label={`Actions for ${subCategory.name}`} items={menu} />}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </DataTable>
        <div className={styles.footer}>
          <Pagination
            page={query.page}
            pageSize={query.pageSize}
            total={totalCount}
            itemLabel="sub-categories"
            onPageChange={(page) => setQuery({ page })}
            onPageSizeChange={(pageSize) => setQuery({ pageSize, page: 1 })}
          />
        </div>
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
