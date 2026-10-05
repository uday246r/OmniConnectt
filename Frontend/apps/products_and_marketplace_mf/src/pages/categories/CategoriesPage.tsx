import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { Button, DataTable, DataTableEmpty, EmptyState, Icon, PageHeader, Pagination, TableSkeleton, formatDate } from '@omniconnect/ui';
import { CatalogIcon } from '../../components/CatalogIcon';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { ListToolbar } from '../../components/ListToolbar';
import { RowMenu, type RowMenuItem } from '../../components/RowMenu';
import { StatusBadge } from '../../components/StatusBadge';
import { usePermissions } from '../../permissions/PermissionContext';
import { PERMISSIONS } from '../../permissions/permissions';
import { categoryApi } from '../../services/categoryApi';
import { useCatalogOptionsStore } from '../../stores/useCatalogOptionsStore';
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

const COLUMNS = 7;

export function CategoriesPage() {
  const { items, totalCount, query, loading, loaded, error } = useCategoryStore(
    useShallow((s) => ({ items: s.items, totalCount: s.totalCount, query: s.query, loading: s.loading, loaded: s.loaded, error: s.error })),
  );
  const fetch = useCategoryStore((s) => s.fetch);
  const setQuery = useCategoryStore((s) => s.setQuery);
  const resetQuery = useCategoryStore((s) => s.resetQuery);
  const invalidateOptions = useCatalogOptionsStore((s) => s.invalidate);
  const statuses = useStatusOptions('Category', { includeDisabled: true });
  const { has } = usePermissions();

  const [editing, setEditing] = useState<Category | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<Category | null>(null);

  useEffect(() => {
    void fetch();
  }, [fetch]);

  const statusOptions = useMemo(() => statuses.map((s) => ({ value: s.value, label: s.label })), [statuses]);
  const canCreate = has(PERMISSIONS.CATEGORIES_CREATE);
  const canEdit = has(PERMISSIONS.CATEGORIES_EDIT);
  const canDelete = has(PERMISSIONS.CATEGORIES_DELETE);

  // Moving a category up or down only means something in the configured order, on the whole list.
  const reorderable = canEdit && query.sort === 'order' && !query.search && !query.status;
  const firstOverall = (index: number) => query.page === 1 && index === 0;
  const lastOverall = (index: number) => (query.page - 1) * query.pageSize + index + 1 >= totalCount;

  const refresh = () => {
    invalidateOptions();
    void fetch();
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

  return (
    <div className={styles.page}>
      <PageHeader
        icon={<Icon.Layers />}
        title="Categories"
        subtitle="Organize your products into categories"
        actions={canCreate ? <Button variant="onHeader" leadingIcon={<Icon.Plus />} onClick={() => openForm(null)}>Add Category</Button> : undefined}
      />

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
      />

      {error && (
        <div role="alert" className={styles.error}>
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={() => void fetch()}>Try again</Button>
        </div>
      )}

      <div className={styles.card} aria-busy={loading}>
        <DataTable minWidth={860}>
          <thead>
            <tr>
              <th scope="col">Category</th>
              <th scope="col">Code</th>
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
                  title={filtered ? 'No categories match' : 'No categories yet'}
                  description={filtered ? 'Try a different search or status.' : 'Add a category to start organising your products.'}
                  action={filtered ? <Button variant="secondary" onClick={resetQuery}>Reset filters</Button> : canCreate ? <Button onClick={() => openForm(null)}>Add Category</Button> : undefined}
                />
              </DataTableEmpty>
            ) : (
              items.map((category, index) => {
                const menu = menuFor(category, index);
                return (
                  <tr key={category.id}>
                    <td>
                      <div className={styles.nameCell}>
                        <CatalogIcon iconKey={category.iconKey} />
                        <span className={styles.name}>{category.name}</span>
                      </div>
                    </td>
                    <td className={styles.mono}>{category.code}</td>
                    <td className={styles.description}>{category.description || '—'}</td>
                    <td><StatusBadge entityType="Category" value={category.status} /></td>
                    <td className={styles.numeric}>{category.productCount}</td>
                    <td className={styles.muted}>{formatDate(category.createdAt)}</td>
                    <td className={styles.actions}>{menu.length > 0 && <RowMenu label={`Actions for ${category.name}`} items={menu} />}</td>
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
            itemLabel="categories"
            onPageChange={(page) => setQuery({ page })}
            onPageSizeChange={(pageSize) => setQuery({ pageSize, page: 1 })}
          />
        </div>
      </div>

      <CategoryFormDrawer open={formOpen} category={editing} onClose={() => setFormOpen(false)} onSaved={refresh} />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete category?"
        destructive
        confirmLabel="Delete category"
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
