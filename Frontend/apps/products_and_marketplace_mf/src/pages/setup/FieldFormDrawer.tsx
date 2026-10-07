import { useEffect, useState, type FormEvent } from 'react';
import { Button, Drawer, FormField, FormGrid, FormSection, Icon, Input, Select, Switch, TextArea } from '@omniconnect/ui';
import { ValidationRulesEditor, describeRuleProblem } from '@omniconnect/ui/validation-editor';
import { useSaveAction } from '../../hooks/useSaveAction';
import { subCategoryApi } from '../../services/subCategoryApi';
import { useToastStore } from '../../stores/useToastStore';
import { FIELD_DATA_TYPES, type FieldDataType, type FieldDefinition, type FieldRule, type SubCategoryDetail } from '../../types/domain';
import page from '../page.module.css';
import styles from './setup.module.css';

export interface FieldFormDrawerProps {
  open: boolean;
  subCategoryId: string;
  /** The field being edited, or null to add one. */
  field: FieldDefinition | null;
  /** How many fields the sub-category has, so a new one is offered the next position. */
  fieldCount: number;
  onClose: () => void;
  onSaved: (detail: SubCategoryDetail) => void;
}

interface FormState {
  label: string;
  dataType: FieldDataType;
  unit: string;
  options: string;
  validations: FieldRule[];
  required: boolean;
  displayOnCard: boolean;
  displayOnDetails: boolean;
  filterable: boolean;
  sortable: boolean;
  isReadOnly: boolean;
  isPrimaryMetric: boolean;
  isSecondaryMetric: boolean;
  sortOrder: string;
}

const FORM_ID = 'field-form';
const BLANK: FormState = {
  label: '', dataType: 'Text', unit: '', options: '', validations: [], required: false, displayOnCard: false, displayOnDetails: true,
  filterable: false, sortable: false, isReadOnly: false, isPrimaryMetric: false, isSecondaryMetric: false, sortOrder: '',
};

const TOGGLES: { key: keyof Pick<FormState, 'required' | 'displayOnCard' | 'displayOnDetails' | 'filterable' | 'sortable' | 'isReadOnly' | 'isPrimaryMetric' | 'isSecondaryMetric'>; label: string }[] = [
  { key: 'required', label: 'Required on every product' },
  { key: 'displayOnCard', label: 'Show on the product card' },
  { key: 'displayOnDetails', label: 'Show in the details' },
  { key: 'isPrimaryMetric', label: 'Key figure (products sort by it)' },
  { key: 'isSecondaryMetric', label: 'Secondary figure' },
  { key: 'filterable', label: 'Can be filtered on' },
  { key: 'sortable', label: 'Can be sorted on' },
  { key: 'isReadOnly', label: 'Read-only in the product form' },
];

const isChoice = (type: FieldDataType) => type === 'Dropdown' || type === 'MultiSelect';

/**
 * Define an attribute every product of a sub-category carries.
 *
 * What is entered here is what the product form renders — its label, its control (by type), its unit,
 * its options and its format rules — and what the product card and details show. Nothing about
 * attributes is compiled in; this is where they come from.
 */
export function FieldFormDrawer({ open, subCategoryId, field, fieldCount, onClose, onSaved }: FieldFormDrawerProps) {
  const save = useSaveAction();
  const [form, setForm] = useState<FormState>(BLANK);
  const [submitted, setSubmitted] = useState(false);
  const isEdit = field !== null;

  useEffect(() => {
    if (!open) return;
    setForm(
      field
        ? {
            label: field.label, dataType: field.dataType, unit: field.unit ?? '', options: (field.options ?? []).join('\n'), validations: field.validations,
            required: field.required, displayOnCard: field.displayOnCard, displayOnDetails: field.displayOnDetails, filterable: field.filterable,
            sortable: field.sortable, isReadOnly: field.isReadOnly, isPrimaryMetric: field.isPrimaryMetric, isSecondaryMetric: field.isSecondaryMetric,
            sortOrder: String(field.sortOrder),
          }
        : { ...BLANK, sortOrder: String(fieldCount + 1) },
    );
    setSubmitted(false);
    save.reset();
    // Only when it opens or the record changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, field]);

  const options = form.options.split('\n').map((o) => o.trim()).filter(Boolean);
  const errors = {
    label: form.label.trim() ? undefined : 'A field needs a label.',
    options: isChoice(form.dataType) && options.length === 0 ? 'Add at least one option, one per line.' : form.dataType === 'MultiSelect' && options.some((o) => o.includes(',')) ? 'Options cannot contain a comma — choices are stored comma-separated.' : undefined,
    rules: describeRuleProblem(form.validations) ?? undefined,
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSubmitted(true);
    if (errors.label || errors.options || errors.rules) return;

    const input = {
      label: form.label.trim(), dataType: form.dataType, unit: form.unit.trim() || null, options: isChoice(form.dataType) ? options : null, validations: form.validations,
      required: form.required, filterable: form.filterable, sortable: form.sortable, displayOnCard: form.displayOnCard, displayOnDetails: form.displayOnDetails,
      isReadOnly: form.isReadOnly, isPrimaryMetric: form.isPrimaryMetric, isSecondaryMetric: form.isSecondaryMetric, sortOrder: Number(form.sortOrder) || 0,
    };
    await save.run(() => (field ? subCategoryApi.updateField(subCategoryId, field.id, input) : subCategoryApi.createField(subCategoryId, input)), {
      onSaved: (detail) => {
        useToastStore.getState().success(isEdit ? 'Field updated' : 'Field added', `"${input.label}" was saved.`);
        onSaved(detail);
        onClose();
      },
      onPending: onClose,
    });
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="640px"
      title={isEdit ? 'Edit field' : 'Add field'}
      subtitle="An attribute every product of this sub-category carries."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={save.saving}>Cancel</Button>
          <Button type="submit" form={FORM_ID} loading={save.saving} disabled={save.saving} leadingIcon={<Icon.Check />}>{isEdit ? 'Save changes' : 'Add field'}</Button>
        </>
      }
    >
      <form id={FORM_ID} onSubmit={submit} noValidate className={page.formStack}>
        {save.error && <p role="alert" className={page.error}>{save.error}</p>}
        <FormSection title="The field" icon={<Icon.FileText width={15} height={15} />}>
          <FormGrid>
            <FormField label="Label" required full error={submitted ? errors.label : undefined} helper="What the product form and card call it, e.g. Interest Rate.">
              {(control) => <Input {...control.aria} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} autoFocus />}
            </FormField>
            <FormField label="Type" helper={isEdit ? 'Cannot change once products hold values for it.' : undefined}>
              {(control) => (
                <Select
                  id={control.id}
                  options={FIELD_DATA_TYPES.map((t) => ({ value: t, label: t }))}
                  value={form.dataType}
                  onChange={(e) => setForm({ ...form, dataType: e.target.value as FieldDataType })}
                />
              )}
            </FormField>
            <FormField label="Unit" helper="Shown beside the value, e.g. ₹, % p.a., years. A currency puts it in front.">
              {(control) => <Input {...control.aria} value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} />}
            </FormField>
            {isChoice(form.dataType) && (
              <FormField label="Options" required full error={submitted ? errors.options : undefined} helper="One per line.">
                {(control) => (
                  <TextArea {...control.aria} rows={4} value={form.options} onChange={(e) => setForm({ ...form, options: e.target.value })} />
                )}
              </FormField>
            )}
            <FormField label="Order" helper="Lower comes first.">
              {(control) => <Input {...control.aria} type="number" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value })} />}
            </FormField>
          </FormGrid>
        </FormSection>

        <FormSection title="How it behaves" icon={<Icon.Settings width={15} height={15} />}>
          <div className={styles.toggles}>
            {TOGGLES.map(({ key, label }) => (
              <label key={key} className={styles.toggle}>
                <Switch checked={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.checked })} /> {label}
              </label>
            ))}
          </div>
        </FormSection>

        <FormSection title="Formats" icon={<Icon.ShieldCheck width={15} height={15} />}>
          <FormField
            label="Formats"
            error={submitted ? errors.rules : undefined}
            helper="Rules a value must meet. Built-in formats only here; ones defined in Manage Formats are still enforced by the server."
          >
            <ValidationRulesEditor rules={form.validations} onChange={(validations) => setForm({ ...form, validations })} customPresets={[]} title="Formats" />
          </FormField>
        </FormSection>
      </form>
    </Drawer>
  );
}
