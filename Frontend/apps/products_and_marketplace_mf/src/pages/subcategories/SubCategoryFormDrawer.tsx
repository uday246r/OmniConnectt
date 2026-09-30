import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Button, Drawer, Icon, Input, Select } from '@omniconnect/ui';
import { CatalogIcon } from '../../components/CatalogIcon';
import { IconPicker } from '../../components/IconPicker';
import { Field } from '../../components/form/Field';
import { TextArea } from '../../components/form/TextArea';
import { useSaveAction } from '../../hooks/useSaveAction';
import { subCategoryApi } from '../../services/subCategoryApi';
import { useCatalogOptionsStore } from '../../stores/useCatalogOptionsStore';
import { useStatusOptions } from '../../stores/useStatusConfigStore';
import { useToastStore } from '../../stores/useToastStore';
import { CODE_HINT, hasErrors, validateCode, validateDescription, validateName } from '../../utils/catalogForm';
import type { SubCategory } from '../../types/domain';
import styles from '../page.module.css';

export interface SubCategoryFormDrawerProps {
  open: boolean;
  /** The sub-category being edited, or null to add one. */
  subCategory: SubCategory | null;
  /** Pre-selects the category when adding from a filtered view. */
  defaultCategoryId?: string;
  onClose: () => void;
  onSaved: () => void;
}

interface FormState {
  categoryId: string;
  name: string;
  code: string;
  description: string;
  iconKey: string;
  status: string;
}

const FORM_ID = 'sub-category-form';

/**
 * Add a sub-category, or edit one.
 *
 * A sub-category is a *type* of product ("Home Loan"); each product under it is an *offering* ("Home Loan –
 * Salaried"). The help text says so, because near-identical names for the two are what make the layer look
 * redundant.
 */
export function SubCategoryFormDrawer({ open, subCategory, defaultCategoryId, onClose, onSaved }: SubCategoryFormDrawerProps) {
  const statusOptions = useStatusOptions('SubCategory');
  const categories = useCatalogOptionsStore((s) => s.categories);
  const loadCategories = useCatalogOptionsStore((s) => s.loadCategories);
  const save = useSaveAction();
  const [form, setForm] = useState<FormState>({ categoryId: '', name: '', code: '', description: '', iconKey: '', status: '' });
  const [submitted, setSubmitted] = useState(false);
  const isEdit = subCategory !== null;

  useEffect(() => {
    if (open) void loadCategories();
  }, [open, loadCategories]);

  useEffect(() => {
    if (!open) return;
    setForm({
      categoryId: subCategory?.categoryId ?? defaultCategoryId ?? '',
      name: subCategory?.name ?? '',
      code: subCategory?.code ?? '',
      description: subCategory?.description ?? '',
      iconKey: subCategory?.iconKey ?? '',
      status: subCategory?.status ?? statusOptions[0]?.value ?? '',
    });
    setSubmitted(false);
    save.reset();
    // Only when it opens or the record changes: a list finishing loading must not wipe what is typed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subCategory, defaultCategoryId]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => setForm((current) => ({ ...current, [key]: value }));

  const errors = {
    categoryId: form.categoryId ? undefined : 'Choose the category this sub-category belongs to.',
    name: validateName(form.name, 'Sub-category'),
    code: validateCode(form.code, 'Sub-category'),
    description: validateDescription(form.description),
  };
  const shown = (key: keyof typeof errors) => (submitted ? errors[key] : undefined);

  const categoryOptions = useMemo(() => categories.map((c) => ({ value: c.id, label: c.name })), [categories]);
  const options = statusOptions.map((s) => ({ value: s.value, label: s.label }));
  if (subCategory && !options.some((o) => o.value === subCategory.status)) options.push({ value: subCategory.status, label: subCategory.status });
  const movingCategory = isEdit && form.categoryId !== '' && form.categoryId !== subCategory.categoryId;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (hasErrors(errors)) return;

    const input = { ...form, name: form.name.trim(), code: form.code.trim(), description: form.description.trim(), displayOrder: 0 };
    await save.run(() => (subCategory ? subCategoryApi.update(subCategory.id, input) : subCategoryApi.create(input)), {
      onSaved: () => {
        useToastStore.getState().success(isEdit ? 'Sub-category updated' : 'Sub-category added', `"${input.name}" was saved.`);
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
      title={isEdit ? 'Edit sub-category' : 'Add sub-category'}
      subtitle="A type of product within a category — Home Loan under Loans. Products are the offerings beneath it."
      icon={<CatalogIcon iconKey={form.iconKey} size="sm" />}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.saving}>Cancel</Button>
          <Button type="submit" form={FORM_ID} loading={save.saving} disabled={save.saving} leadingIcon={<Icon.Check />}>
            {isEdit ? 'Save changes' : 'Add sub-category'}
          </Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} noValidate className={styles.formStack}>
        {save.error && <p role="alert" className={styles.error}>{save.error}</p>}
        <Field label="Category" required error={shown('categoryId')} helper={movingCategory ? 'Every product beneath this sub-category moves to the new category with it.' : undefined}>
          <Select aria-label="Category" options={categoryOptions} value={form.categoryId} placeholder="Choose a category" onChange={(e) => set('categoryId', e.target.value)} />
        </Field>
        <Input label="Sub-category name" value={form.name} onChange={(e) => set('name', e.target.value)} errorText={shown('name')} helperText="A type of product, e.g. Home Loan — not one specific offering." required autoFocus />
        <Input label="Sub-category code" value={form.code} onChange={(e) => set('code', e.target.value)} errorText={shown('code')} helperText={`${CODE_HINT} Unique across the whole catalogue.`} required />
        <TextArea label="Description" value={form.description} onChange={(e) => set('description', e.target.value)} errorText={shown('description')} />
        <Field label="Status" helper="Which statuses exist, and which make a sub-category live, is set in Setup.">
          <Select aria-label="Status" options={options} value={form.status} onChange={(e) => set('status', e.target.value)} />
        </Field>
        <Field label="Icon">
          <IconPicker label="Sub-category icon" value={form.iconKey} onChange={(key) => set('iconKey', key)} />
        </Field>
      </form>
    </Drawer>
  );
}
