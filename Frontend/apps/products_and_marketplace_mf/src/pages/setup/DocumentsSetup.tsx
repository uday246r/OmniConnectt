import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Badge, Button, DataTable, DataTableEmpty, Drawer, EmptyState, Icon, Input, RowAction, Select, Switch, TableSkeleton } from '@omniconnect/ui';
import { ConfirmDialog } from '../../components/ConfirmDialog';
import { Field } from '../../components/form/Field';
import { useSaveAction } from '../../hooks/useSaveAction';
import { usePermissions } from '../../permissions/PermissionContext';
import { PERMISSIONS } from '../../permissions/permissions';
import { documentDefinitionApi } from '../../services/documentDefinitionApi';
import { subCategoryApi } from '../../services/subCategoryApi';
import { useToastStore } from '../../stores/useToastStore';
import type { DocumentDefinition, SubCategory } from '../../types/domain';
import page from '../page.module.css';
import styles from './setup.module.css';

interface FormState { name: string; documentType: string; subCategoryId: string; required: boolean; active: boolean; sortOrder: string }

const FORM_ID = 'document-form';
const EVERYTHING = 100;
const COLUMNS = 6;

/**
 * Setup → Documents: the documents a customer is asked for, either for every product or for one
 * sub-category (property papers for a home loan, nothing for a savings account).
 */
export function DocumentsSetup() {
  const canManage = usePermissions().has(PERMISSIONS.SETUP_MANAGE);
  const [documents, setDocuments] = useState<DocumentDefinition[]>([]);
  const [subCategories, setSubCategories] = useState<SubCategory[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<DocumentDefinition | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [deleting, setDeleting] = useState<DocumentDefinition | null>(null);
  const [form, setForm] = useState<FormState>({ name: '', documentType: '', subCategoryId: '', required: true, active: true, sortOrder: '' });
  const [submitted, setSubmitted] = useState(false);
  const save = useSaveAction();

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [docs, subs] = await Promise.all([
        documentDefinitionApi.list(),
        subCategoryApi.list({ search: '', categoryId: '', status: '', sort: 'order', page: 1, pageSize: EVERYTHING }),
      ]);
      setDocuments(docs);
      setSubCategories(subs.items);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const scopeOptions = useMemo(() => subCategories.map((s) => ({ value: s.id, label: `${s.name} (${s.categoryName})` })), [subCategories]);

  const open = (doc: DocumentDefinition | null) => {
    setForm(
      doc
        ? { name: doc.name, documentType: doc.documentType, subCategoryId: doc.subCategoryId ?? '', required: doc.required, active: doc.active, sortOrder: String(doc.sortOrder) }
        : { name: '', documentType: '', subCategoryId: '', required: true, active: true, sortOrder: String(documents.length + 1) },
    );
    setSubmitted(false);
    save.reset();
    setEditing(doc);
    setFormOpen(true);
  };

  const nameError = form.name.trim() ? undefined : 'A document needs a name.';

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (nameError) return;
    const input = { name: form.name.trim(), documentType: form.documentType.trim(), subCategoryId: form.subCategoryId || null, required: form.required, active: form.active, sortOrder: Number(form.sortOrder) || 0 };
    await save.run(() => (editing ? documentDefinitionApi.update(editing.id, input) : documentDefinitionApi.create(input)), {
      onSaved: () => {
        useToastStore.getState().success(editing ? 'Document updated' : 'Document added', `"${input.name}" was saved.`);
        setFormOpen(false);
        void load();
      },
      onPending: () => setFormOpen(false),
    });
  };

  return (
    <div className={styles.section}>
      <div className={styles.sectionHead}>
        <div>
          <h2 className={styles.sectionTitle}>Documents</h2>
          <p className={styles.sectionHint}>What a customer is asked to provide — for every product, or only for one sub-category.</p>
        </div>
        {canManage && <Button leadingIcon={<Icon.Plus />} onClick={() => open(null)}>Add document</Button>}
      </div>

      {error && <div role="alert" className={page.error}>{error}</div>}

      <div className={page.card} aria-busy={loading}>
        <DataTable minWidth={760}>
          <thead>
            <tr>
              <th scope="col">Document</th>
              <th scope="col">Type</th>
              <th scope="col">Applies to</th>
              <th scope="col">Required</th>
              <th scope="col">Active</th>
              <th scope="col"><span className={page.srOnly}>Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {loading && documents.length === 0 ? (
              <TableSkeleton rows={4} columns={COLUMNS} />
            ) : documents.length === 0 ? (
              <DataTableEmpty colSpan={COLUMNS}>
                <EmptyState compact icon={<Icon.FileText />} title="No documents yet" description="Add the documents customers should provide." action={canManage ? <Button onClick={() => open(null)}>Add document</Button> : undefined} />
              </DataTableEmpty>
            ) : (
              documents.map((doc) => (
                <tr key={doc.id}>
                  <td className={page.name}>{doc.name}</td>
                  <td className={page.muted}>{doc.documentType || '—'}</td>
                  <td>{doc.subCategoryName ?? <Badge tone="info">Every product</Badge>}</td>
                  <td><Badge tone={doc.required ? 'danger' : 'neutral'}>{doc.required ? 'Required' : 'Optional'}</Badge></td>
                  <td><Badge tone={doc.active ? 'success' : 'neutral'}>{doc.active ? 'Active' : 'Inactive'}</Badge></td>
                  <td className={page.actions}>
                    {canManage && (
                      <>
                        <RowAction onClick={() => open(doc)} aria-label={`Edit ${doc.name}`}>Edit</RowAction>
                        <RowAction onClick={() => setDeleting(doc)} aria-label={`Delete ${doc.name}`}>Delete</RowAction>
                      </>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
      </div>

      <Drawer
        open={formOpen}
        onClose={() => setFormOpen(false)}
        title={editing ? 'Edit document' : 'Add document'}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormOpen(false)} disabled={save.saving}>Cancel</Button>
            <Button type="submit" form={FORM_ID} loading={save.saving} disabled={save.saving} leadingIcon={<Icon.Check />}>{editing ? 'Save changes' : 'Add document'}</Button>
          </>
        }
      >
        <form id={FORM_ID} onSubmit={submit} noValidate className={page.formStack}>
          {save.error && <p role="alert" className={page.error}>{save.error}</p>}
          <Input label="Name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} errorText={submitted ? nameError : undefined} helperText="e.g. Proof of income." required autoFocus />
          <Input label="Kind of document" value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value })} helperText="Optional grouping, e.g. Identity, Income, Property." />
          <Field label="Applies to" helper="Leave empty for a document every product needs.">
            <Select aria-label="Applies to" options={scopeOptions} value={form.subCategoryId} placeholder="Every product" clearLabel="Every product" onChange={(e) => setForm({ ...form, subCategoryId: e.target.value })} />
          </Field>
          <Input label="Order" type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />
          <label className={styles.toggle}><Switch checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} /> Required</label>
          <label className={styles.toggle}><Switch checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active — currently asked for</label>
        </form>
      </Drawer>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete document?"
        destructive
        confirmLabel="Delete document"
        message={<><strong>{deleting?.name}</strong> will no longer be asked for.</>}
        onConfirm={async () => {
          if (!deleting) return;
          await documentDefinitionApi.remove(deleting.id);
          useToastStore.getState().success('Document deleted', `"${deleting.name}" was removed.`);
          void load();
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
