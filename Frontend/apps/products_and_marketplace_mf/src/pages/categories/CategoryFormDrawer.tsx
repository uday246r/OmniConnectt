import { useEffect, useState, type FormEvent } from 'react';
import { Button, Drawer, Icon, Input, Select } from '@omniconnect/ui';
import { CatalogIcon } from '../../components/CatalogIcon';
import { IconPicker } from '../../components/IconPicker';
import { Field } from '../../components/form/Field';
import { TextArea } from '../../components/form/TextArea';
import { useSaveAction } from '../../hooks/useSaveAction';
import { categoryApi } from '../../services/categoryApi';
import { useStatusOptions } from '../../stores/useStatusConfigStore';
import { useToastStore } from '../../stores/useToastStore';
import { CODE_HINT, hasErrors, validateCode, validateDescription, validateName } from '../../utils/catalogForm';
import type { Category } from '../../types/domain';
import styles from '../page.module.css';

export interface CategoryFormDrawerProps {
  open: boolean;
  /** The category being edited, or null to add one. */
  category: Category | null;
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  name: string;
  code: string;
  description: string;
  iconKey: string;
  status: string;
}

const FORM_ID = 'category-form';

/** Add a category, or edit one. Everything that can vary — statuses, icons — comes from Setup and the icon set, not from this file. */
export function CategoryFormDrawer({ open, category, onClose, onSaved }: CategoryFormDrawerProps) {
  const statusOptions = useStatusOptions('Category');
  const save = useSaveAction();
  const [form, setForm] = useState<FormState>({ name: '', code: '', description: '', iconKey: '', status: '' });
  const [submitted, setSubmitted] = useState(false);
  const isEdit = category !== null;

  // Start each opening from the record (or a blank one). New categories begin at the status Setup lists first —
  // the same one the server would choose — so the form and the server never disagree about the default.
  useEffect(() => {
    if (!open) return;
    setForm({
      name: category?.name ?? '',
      code: category?.code ?? '',
      description: category?.description ?? '',
      iconKey: category?.iconKey ?? '',
      status: category?.status ?? statusOptions[0]?.value ?? '',
    });
    setSubmitted(false);
    save.reset();
    // Only when it opens or the record changes: a status list finishing loading must not wipe what is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, category]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  const errors = {
    name: validateName(form.name, 'Category'),
    code: validateCode(form.code, 'Category'),
    description: validateDescription(form.description),
  };
  const shown = (key: keyof typeof errors) => (submitted ? errors[key] : undefined);

  // A status Setup has since switched off stays selectable on the record that already holds it.
  const options = statusOptions.map((s) => ({ value: s.value, label: s.label }));
  if (category && !options.some((o) => o.value === category.status)) options.push({ value: category.status, label: category.status });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (hasErrors(errors)) return;

    const input = { ...form, name: form.name.trim(), code: form.code.trim(), description: form.description.trim(), displayOrder: category?.displayOrder ?? 0 };
    await save.run(() => (category ? categoryApi.update(category.id, input) : categoryApi.create(input)), {
      onSaved: () => {
        useToastStore.getState().success(isEdit ? 'Category updated' : 'Category added', `"${input.name}" was saved.`);
        onSaved();
        onClose();
      },
      onPending: onClose,
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={isEdit ? 'Edit category' : 'Add category'}
      subtitle="A line of business, like Loans or Credit Cards. Sub-categories and products sit beneath it."
      icon={<CatalogIcon iconKey={form.iconKey} size="sm" />}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.saving}>Cancel</Button>
          <Button type="submit" form={FORM_ID} loading={save.saving} disabled={save.saving} leadingIcon={<Icon.Check />}>
            {isEdit ? 'Save changes' : 'Add category'}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} noValidate className={styles.formStack}>
        {save.error && <p role="alert" className={styles.error}>{save.error}</p>}
        <Input label="Category name" value={form.name} onChange={(e) => set('name', e.target.value)} errorText={shown('name')} required autoFocus />
        <Input label="Category code" value={form.code} onChange={(e) => set('code', e.target.value)} errorText={shown('code')} helperText={CODE_HINT} required />
        <TextArea label="Description" value={form.description} onChange={(e) => set('description', e.target.value)} errorText={shown('description')} />
        <Field label="Status" helper="Which statuses exist, and which make a category live, is set in Setup.">
          <Select aria-label="Status" options={options} value={form.status} onChange={(e) => set('status', e.target.value)} />
        </Field>
        <Field label="Icon">
          <IconPicker label="Category icon" value={form.iconKey} onChange={(key) => set('iconKey', key)} />
        </Field>
      </form>
    </Drawer>
  );
}
