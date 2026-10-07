import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Badge, Button, ConfirmDialog, DataTable, Drawer, FormField, FormGrid, FormSection, Icon, Input, ResponsiveRows, RowAction, Select, Switch, type ResponsiveColumn } from '@omniconnect/ui';
import { useSaveAction } from '../../hooks/useSaveAction';
import { usePermissions } from '../../permissions/PermissionContext';
import { PERMISSIONS } from '../../permissions/permissions';
import { isApprovalPending } from '../../services/httpClient';
import { useStatusConfigStore, useStatusEntityTypes } from '../../stores/useStatusConfigStore';
import { useToastStore } from '../../stores/useToastStore';
import type { StatusConfig, StatusEntityType, StatusTone } from '../../types/domain';
import { STATUS_TONES, humanizeEntityType } from './statusTones';
import page from '../page.module.css';
import styles from './setup.module.css';

interface FormState { value: string; label: string; color: StatusTone; enabled: boolean; isLive: boolean; sortOrder: string }

const FORM_ID = 'status-form';

/**
 * Setup → Statuses: what each kind of record can be, what it is called, what colour it is, and which
 * statuses make it live in the catalogue.
 *
 * "Live" is the important one. The catalogue never compares a status to a word like "Active" — it asks
 * which statuses are live — so changing it here changes what customers see, immediately.
 */
export function StatusesSetup() {
  const configs = useStatusConfigStore((s) => s.configs);
  const loading = useStatusConfigStore((s) => s.loading);
  const fetchAll = useStatusConfigStore((s) => s.fetchAll);
  const updateConfig = useStatusConfigStore((s) => s.updateConfig);
  const createConfig = useStatusConfigStore((s) => s.createConfig);
  const removeConfig = useStatusConfigStore((s) => s.removeConfig);
  const entityTypes = useStatusEntityTypes();
  const canManage = usePermissions().has(PERMISSIONS.SETUP_MANAGE);

  const [formFor, setFormFor] = useState<{ entityType: StatusEntityType; status: StatusConfig | null } | null>(null);
  const [deleting, setDeleting] = useState<StatusConfig | null>(null);
  const [form, setForm] = useState<FormState>({ value: '', label: '', color: 'neutral', enabled: true, isLive: false, sortOrder: '' });
  const [submitted, setSubmitted] = useState(false);
  const save = useSaveAction();

  useEffect(() => {
    void fetchAll();
  }, [fetchAll]);

  const grouped = useMemo(
    () => entityTypes.map((type) => ({ type, rows: configs.filter((c) => c.entityType === type).sort((a, b) => a.sortOrder - b.sortOrder) })),
    [entityTypes, configs],
  );

  const open = (entityType: StatusEntityType, status: StatusConfig | null) => {
    const next = (configs.filter((c) => c.entityType === entityType).reduce((max, c) => Math.max(max, c.sortOrder), 0) || 0) + 1;
    setForm(
      status
        ? { value: status.value, label: status.label, color: status.color, enabled: status.enabled, isLive: status.isLive, sortOrder: String(status.sortOrder) }
        : { value: '', label: '', color: 'neutral', enabled: true, isLive: false, sortOrder: String(next) },
    );
    setSubmitted(false);
    save.reset();
    setFormFor({ entityType, status });
  };

  // A quick change from the table: the same rules apply (the only live status cannot be switched off).
  const toggle = async (status: StatusConfig, change: Partial<Pick<StatusConfig, 'enabled' | 'isLive'>>) => {
    try {
      await updateConfig(status.id, { label: status.label, color: status.color, enabled: status.enabled, isLive: status.isLive, sortOrder: status.sortOrder, ...change });
    } catch (err) {
      if (!isApprovalPending(err)) useToastStore.getState().danger('Could not change the status', (err as Error).message);
      void fetchAll({ force: true });
    }
  };

  const errors = {
    value: formFor?.status ? undefined : !/^[A-Za-z][A-Za-z0-9]*$/.test(form.value.trim()) ? 'Start with a letter; letters and numbers only, no spaces.' : undefined,
    label: form.label.trim() ? undefined : 'A status needs a label.',
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (!formFor || errors.value || errors.label) return;
    const input = { label: form.label.trim(), color: form.color, enabled: form.enabled, isLive: form.isLive, sortOrder: Number(form.sortOrder) || 0 };
    await save.run(() => (formFor.status ? updateConfig(formFor.status.id, input) : createConfig({ ...input, entityType: formFor.entityType, value: form.value.trim() })), {
      onSaved: () => {
        useToastStore.getState().success(formFor.status ? 'Status updated' : 'Status added', `"${input.label}" was saved.`);
        setFormFor(null);
      },
      onPending: () => setFormFor(null),
    });
  };

  /* One set of columns for every entity type's table: the rows differ, the shape does not. */
  const columnsFor = (type: StatusEntityType): ResponsiveColumn<StatusConfig>[] => [
    { key: 'label', label: 'Status', priority: 'always', render: (status) => <Badge tone={status.color}>{status.label}</Badge> },
    { key: 'value', label: 'Value', priority: 'low', render: (status) => <span className={styles.mono}>{status.value}</span> },
    {
      key: 'live',
      label: 'Live in catalogue',
      priority: 'high',
      render: (status) => (
        <Switch aria-label={`${status.label} is live`} checked={status.isLive} disabled={!canManage} onChange={(e) => void toggle(status, { isLive: e.target.checked })} />
      ),
    },
    {
      key: 'enabled',
      label: 'Can be chosen',
      priority: 'high',
      render: (status) => (
        <Switch aria-label={`${status.label} can be chosen`} checked={status.enabled} disabled={!canManage} onChange={(e) => void toggle(status, { enabled: e.target.checked })} />
      ),
    },
    { key: 'order', label: 'Order', priority: 'low', render: (status) => <span className={page.numeric}>{status.sortOrder}</span> },
    {
      key: 'actions',
      label: <span className={page.srOnly}>Actions</span>,
      priority: 'always',
      align: 'right',
      render: (status) =>
        canManage ? (
          <>
            <RowAction onClick={() => open(type, status)} aria-label={`Edit ${status.label}`}>Edit</RowAction>
            <RowAction onClick={() => setDeleting(status)} aria-label={`Delete ${status.label}`}>Delete</RowAction>
          </>
        ) : null,
    },
  ];

  return (
    <div className={styles.section}>

      {grouped.map(({ type, rows }) => (
        <div key={type} className={page.card}>
          <div className={styles.sectionHead}>
            <div>
              <h3 className={styles.sectionTitle}>{humanizeEntityType(type)} statuses</h3>
              <p className={styles.sectionHint}>
                A <strong>live</strong> status makes a record show in the catalogue; anything else hides it.
              </p>
            </div>
            {canManage && <Button variant="secondary" size="sm" leadingIcon={<Icon.Plus />} onClick={() => open(type, null)}>Add status</Button>}
          </div>
          <DataTable bare>
            {/* Was the one table in this app with no skeleton and no empty state — just a bare
                "No statuses defined." cell. ResponsiveRows gives it both, from the same columns. */}
            <ResponsiveRows
              columns={columnsFor(type)}
              rows={rows}
              rowKey={(status) => status.id}
              loading={loading && rows.length === 0}
              loadingRows={3}
              empty={`No ${humanizeEntityType(type).toLowerCase()} statuses defined yet.`}
            />
          </DataTable>
        </div>
      ))}

      <Drawer
        open={formFor !== null}
        onClose={() => setFormFor(null)}
        title={formFor?.status ? 'Edit status' : 'Add status'}
        subtitle={formFor ? `For ${humanizeEntityType(formFor.entityType).toLowerCase()} records` : undefined}
        footer={
          <>
            <Button variant="secondary" onClick={() => setFormFor(null)} disabled={save.saving}>Cancel</Button>
            <Button type="submit" form={FORM_ID} loading={save.saving} disabled={save.saving} leadingIcon={<Icon.Check />}>{formFor?.status ? 'Save changes' : 'Add status'}</Button>
          </>
        }
      >
        <form id={FORM_ID} onSubmit={submit} noValidate className={page.formStack}>
          {save.error && <p role="alert" className={page.error}>{save.error}</p>}

          <FormSection title="Status" icon={<Icon.Activity width={15} height={15} />}>
            <FormGrid>
              <FormField
                label="Value"
                required
                error={submitted ? errors.value : undefined}
                helper={formFor?.status ? 'A status value cannot change once records may hold it.' : 'What is stored on a record, e.g. PendingReview.'}
              >
                {(control) => (
                  <Input {...control.aria} value={form.value} disabled={Boolean(formFor?.status)} onChange={(e) => setForm({ ...form, value: e.target.value })} />
                )}
              </FormField>
              <FormField label="Label" required error={submitted ? errors.label : undefined} helper="What people see, e.g. Pending review.">
                {(control) => <Input {...control.aria} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />}
              </FormField>
              <FormField label="Colour">
                {(control) => (
                  <div className={styles.tonePreview}>
                    <Select
                      id={control.id}
                      options={STATUS_TONES.map((t) => ({ value: t, label: t.charAt(0).toUpperCase() + t.slice(1) }))}
                      value={form.color}
                      onChange={(e) => setForm({ ...form, color: e.target.value as StatusTone })}
                    />
                    <Badge tone={form.color}>{form.label || 'Preview'}</Badge>
                  </div>
                )}
              </FormField>
              <FormField label="Order" helper="Lower comes first. The first enabled status is what a new record starts as.">
                {(control) => <Input {...control.aria} type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />}
              </FormField>
            </FormGrid>
          </FormSection>

          <FormSection title="What it does" icon={<Icon.Eye width={15} height={15} />}>
            <label className={styles.toggle}>
              <Switch checked={form.isLive} onChange={(e) => setForm({ ...form, isLive: e.target.checked })} /> Live — records with this status show in the catalogue
            </label>
            <label className={styles.toggle}>
              <Switch checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Can be chosen for new and edited records
            </label>
          </FormSection>
        </form>
      </Drawer>

      <ConfirmDialog
        open={deleting !== null}
        title="Delete status?"
        destructive
        confirmLabel="Delete status"
        message={<><strong>{deleting?.label}</strong> will be removed. A status that records still hold, or the only live one, cannot be deleted.</>}
        onConfirm={async () => {
          if (!deleting) return;
          await removeConfig(deleting.id);
          useToastStore.getState().success('Status deleted', `"${deleting.label}" was removed.`);
        }}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
