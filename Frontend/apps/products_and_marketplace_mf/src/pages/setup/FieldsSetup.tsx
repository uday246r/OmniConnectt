import { useEffect, useMemo, useState } from 'react';
import { Badge, Button, DataTable, DataTableEmpty, EmptyState, Icon, RowAction, Select, TableSkeleton } from '@omniconnect/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { usePermissions } from '../../permissions/PermissionContext';
import { PERMISSIONS } from '../../permissions/permissions';
import { subCategoryApi } from '../../services/subCategoryApi';
import { useCatalogOptionsStore } from '../../stores/useCatalogOptionsStore';
import { useToastStore } from '../../stores/useToastStore';
import type { FieldDefinition, SubCategoryDetail } from '../../types/domain';
import { FieldFormDrawer } from './FieldFormDrawer';
import page from '../page.module.css';
import styles from './setup.module.css';

const COLUMNS = 6;

/** Setup → Fields: the attributes each sub-category's products carry. Pick a sub-category, then define them. */
export function FieldsSetup() {
  const categories = useCatalogOptionsStore((s) => s.categories);
  const subCategoriesByCategory = useCatalogOptionsStore((s) => s.subCategoriesByCategory);
  const loadCategories = useCatalogOptionsStore((s) => s.loadCategories);
  const loadSubCategories = useCatalogOptionsStore((s) => s.loadSubCategories);
  const canManage = usePermissions().has(PERMISSIONS.SETUP_MANAGE);

  const [categoryId, setCategoryId] = useState('');
  const [subCategoryId, setSubCategoryId] = useState('');
  const [detail, setDetail] = useState<SubCategoryDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<FieldDefinition | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<FieldDefinition | null>(null);

  useEffect(() => {
    void loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    if (categoryId) void loadSubCategories(categoryId);
  }, [categoryId, loadSubCategories]);

  useEffect(() => {
    if (!subCategoryId) {
      setDetail(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    subCategoryApi
      .get(subCategoryId, controller.signal)
      .then(setDetail)
      .catch((err: Error) => !controller.signal.aborted && setError(err.message))
      .finally(() => !controller.signal.aborted && setLoading(false));
    return () => controller.abort();
  }, [subCategoryId]);

  const categoryOptions = useMemo(() => categories.map((c) => ({ value: c.id, label: c.name })), [categories]);
  const subOptions = useMemo(() => (subCategoriesByCategory[categoryId] ?? []).map((s) => ({ value: s.id, label: s.name })), [subCategoriesByCategory, categoryId]);
  const fields = useMemo(() => [...(detail?.fieldDefinitions ?? [])].sort((a, b) => a.sortOrder - b.sortOrder), [detail]);

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <div>
          <h2 className={styles.sectionTitle}>Fields</h2>
          <p className={styles.sectionHint}>The attributes products carry are defined per sub-category, so every home loan asks for the same things without configuring each one.</p>
        </div>
        {canManage && subCategoryId && <Button leadingIcon={<Icon.Plus />} onClick={() => { setEditing(null); setFormOpen(true); }}>Add field</Button>}
      </div>

      <div className={styles.pickers}>
        <div className={styles.picker}>
          <Select aria-label="Category" options={categoryOptions} value={categoryId} placeholder="Choose a category" onChange={(e) => { setCategoryId(e.target.value); setSubCategoryId(''); }} />
        </div>
        <div className={styles.picker}>
          <Select aria-label="Sub-category" options={subOptions} value={subCategoryId} placeholder={categoryId ? 'Choose a sub-category' : 'Choose a category first'} disabled={!categoryId} onChange={(e) => setSubCategoryId(e.target.value)} />
        </div>
      </div>

      {error && <div role="alert" className={page.error}>{error}</div>}

      {!subCategoryId ? (
        <div className={page.card}><EmptyState compact icon={<Icon.Layers />} title="Choose a sub-category" description="Pick a category and a sub-category to see and define the attributes its products carry." /></div>
      ) : (
        <div className={page.card} aria-busy={loading}>
          <DataTable minWidth={760}>
            <thead>
              <tr>
                <th scope="col">Field</th>
                <th scope="col">Type</th>
                <th scope="col">Shown</th>
                <th scope="col" className={page.numeric}>Formats</th>
                <th scope="col" className={page.numeric}>Order</th>
                <th scope="col"><span className={page.srOnly}>Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {loading && !detail ? (
                <TableSkeleton rows={4} columns={COLUMNS} />
              ) : fields.length === 0 ? (
                <DataTableEmpty colSpan={COLUMNS}>
                  <EmptyState compact icon={<Icon.FileText />} title="No fields yet" description="Add the attributes products of this sub-category carry — a rate, a fee, a tenure." action={canManage ? <Button onClick={() => { setEditing(null); setFormOpen(true); }}>Add field</Button> : undefined} />
                </DataTableEmpty>
              ) : (
                fields.map((field) => (
                  <tr key={field.id}>
                    <td>
                      <div className={page.nameText}>
                        <span className={page.name}>{field.label}</span>
                        <span className={styles.mono}>{field.key}</span>
                      </div>
                    </td>
                    <td>{field.dataType}{field.unit ? <span className={page.sub}> · {field.unit}</span> : null}</td>
                    <td>
                      <div className={styles.flags}>
                        {field.required && <Badge tone="danger">Required</Badge>}
                        {field.displayOnCard && <Badge tone="info">Card</Badge>}
                        {field.displayOnDetails && <Badge tone="neutral">Details</Badge>}
                        {field.isPrimaryMetric && <Badge tone="success">Key figure</Badge>}
                      </div>
                    </td>
                    <td className={page.numeric}>{field.validations.length}</td>
                    <td className={page.numeric}>{field.sortOrder}</td>
                    <td className={page.actions}>
                      {canManage && (
                        <>
                          <RowAction onClick={() => { setEditing(field); setFormOpen(true); }} aria-label={`Edit ${field.label}`}>Edit</RowAction>
                          <RowAction onClick={() => setDeleting(field)} aria-label={`Delete ${field.label}`}>Delete</RowAction>
                        </>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </DataTable>
        </div>
      )}

      <FieldFormDrawer open={formOpen} subCategoryId={subCategoryId} field={editing} fieldCount={fields.length} onClose={() => setFormOpen(false)} onSaved={setDetail} />

      <ConfirmDialog
        open={deleting !== null}
        title="Delete field?"
        destructive
        confirmLabel="Delete field"
        message={<><strong>{deleting?.label}</strong> will no longer be asked for. A field that products already hold a value for cannot be deleted.</>}
        onConfirm={async () => {
          if (!deleting) return;
          setDetail(await subCategoryApi.removeField(subCategoryId, deleting.id));
          useToastStore.getState().success('Field deleted', `"${deleting.label}" was removed.`);
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
