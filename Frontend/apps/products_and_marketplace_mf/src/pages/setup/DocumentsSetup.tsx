import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import { Badge, Button, ConfirmDialog, DataTable, Drawer, FormField, FormGrid, FormSection, Icon, Input, ResponsiveRows, RowAction, Select, Switch, type ResponsiveColumn } from '@omniconnect/ui';
import { useSaveAction } from '../../hooks/useSaveAction';
import { usePermissions } from '../../permissions/PermissionContext';
import { PERMISSIONS } from '../../permissions/permissions';
import { documentDefinitionApi } from '../../services/documentDefinitionApi';
import { isApprovalPending } from '../../services/httpClient';
import { subCategoryApi } from '../../services/subCategoryApi';
import { useToastStore } from '../../stores/useToastStore';
import type { DocumentDefinition, SubCategory } from '../../types/domain';
import page from '../page.module.css';
import styles from './setup.module.css';
import { SetupSectionHead } from './SetupSectionHead';

interface FormState { name: string; documentType: string; subCategoryId: string; required: boolean; active: boolean; sortOrder: string }

const FORM_ID = 'document-form';
const EVERYTHING = 100;

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

  const columns: ResponsiveColumn<DocumentDefinition>[] = [
    { key: 'name', label: 'Document', priority: 'always', render: (doc) => <span className={page.name}>{doc.name}</span> },
    { key: 'type', label: 'Type', priority: 'low', render: (doc) => <span className={page.muted}>{doc.documentType || '—'}</span> },
    {
      key: 'scope',
      label: 'Applies to',
      priority: 'high',
      render: (doc) => doc.subCategoryName ?? <Badge tone="info">Every product</Badge>,
    },
    {
      key: 'required',
      label: 'Required',
      priority: 'high',
      render: (doc) => <Badge tone={doc.required ? 'danger' : 'neutral'}>{doc.required ? 'Required' : 'Optional'}</Badge>,
    },
    {
      key: 'active',
      label: 'Active',
      priority: 'low',
      render: (doc) => <Badge tone={doc.active ? 'success' : 'neutral'}>{doc.active ? 'Active' : 'Inactive'}</Badge>,
    },
    {
      key: 'actions',
      label: <span className={page.srOnly}>Actions</span>,
      priority: 'always',
      align: 'right',
      render: (doc) =>
        canManage ? (
          <>
            <RowAction onClick={() => open(doc)} aria-label={`Edit ${doc.name}`}>Edit</RowAction>
            <RowAction onClick={() => setDeleting(doc)} aria-label={`Delete ${doc.name}`}>Delete</RowAction>
          </>
        ) : null,
    },
  ];

  return (
    <div className={styles.section}>
      {error && <div role="alert" className={page.error}>{error}</div>}

      <div className={page.card} aria-busy={loading}>
        <SetupSectionHead
          icon={<Icon.FileText />}
          title="Documents"
          hint="What a customer is asked to provide — for every product, or only for one sub-category."
          action={canManage ? <Button size="sm" leadingIcon={<Icon.Plus />} onClick={() => open(null)}>Add document</Button> : undefined}
        />

        <DataTable bare>
          <ResponsiveRows
            columns={columns}
            rows={documents}
            rowKey={(doc) => doc.id}
            loading={loading && documents.length === 0}
            loadingRows={4}
            empty="No documents yet. Add the documents customers should provide."
          />
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

          <FormSection title="Document" icon={<Icon.FileText width={15} height={15} />}>
            <FormGrid>
              <FormField label="Name" required full error={submitted ? nameError : undefined} helper="e.g. Proof of income.">
                {(control) => <Input {...control.aria} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />}
              </FormField>
              <FormField label="Kind of document" helper="Optional grouping, e.g. Identity, Income, Property.">
                {(control) => <Input {...control.aria} value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value })} />}
              </FormField>
              <FormField label="Order">
                {(control) => <Input {...control.aria} type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />}
              </FormField>
              <FormField label="Applies to" full helper="Leave empty for a document every product needs.">
                {(control) => (
                  <Select id={control.id} options={scopeOptions} value={form.subCategoryId} placeholder="Every product" clearLabel="Every product" onChange={(e) => setForm({ ...form, subCategoryId: e.target.value })} />
                )}
              </FormField>
            </FormGrid>
          </FormSection>

          <FormSection title="When it is asked for" icon={<Icon.CheckCircle width={15} height={15} />}>
            <label className={styles.toggle}>
              <Switch checked={form.required} onChange={(e) => setForm({ ...form, required: e.target.checked })} /> Required
            </label>
            <label className={styles.toggle}>
              <Switch checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Active — currently asked for
            </label>
          </FormSection>
        </form>
      </Drawer>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete document?"
        destructive
        confirmLabel="Delete document"
        pendingApproval={isApprovalPending}
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
