import { Checkbox, FormField, Input, Select, Switch } from '@omniconnect/ui';
import { joinChoices, splitChoices } from '../../utils/productForm';
import type { FieldDefinition } from '../../types/domain';
import styles from './products.module.css';

export interface ProductFieldInputProps {
  field: FieldDefinition;
  value: string;
  error?: string;
  onChange: (value: string) => void;
}

/**
 * The right control for one attribute, chosen by the field's data type.
 *
 * Nothing here is specific to any product: a home loan's "Tenure" dropdown and a card's "Annual Fee"
 * amount are both drawn from their definitions. The unit (₹, % p.a., years) is the definition's own, shown
 * beside the value, so the form never assumes a currency.
 */
export function ProductFieldInput({ field, value, error, onChange }: ProductFieldInputProps) {
  const disabled = field.isReadOnly;

  switch (field.dataType) {
    case 'Boolean':
      return (
        <FormField label={field.label} required={field.required} error={error}>
          <Switch aria-label={field.label} checked={value.toLowerCase() === 'true'} disabled={disabled} onChange={(e) => onChange(e.target.checked ? 'true' : 'false')} />
        </FormField>
      );

    case 'Dropdown':
      return (
        <FormField label={field.label} required={field.required} error={error}>
          <Select
            aria-label={field.label}
            options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
            value={value}
            placeholder={`Choose ${field.label.toLowerCase()}`}
            clearLabel={field.required ? undefined : 'None'}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        </FormField>
      );

    case 'MultiSelect': {
      const chosen = new Set(splitChoices(value).map((c) => c.toLowerCase()));
      const toggle = (option: string, on: boolean) => {
        const next = (field.options ?? []).filter((o) => (o === option ? on : chosen.has(o.toLowerCase())));
        onChange(joinChoices(next));
      };
      return (
        <FormField label={field.label} required={field.required} error={error}>
          <div className={styles.choices}>
            {(field.options ?? []).map((option) => (
              <Checkbox key={option} label={option} checked={chosen.has(option.toLowerCase())} disabled={disabled} onChange={(e) => toggle(option, e.target.checked)} />
            ))}
          </div>
        </FormField>
      );
    }

    // Every branch goes through FormField, including the plain text ones, so one attribute's label is
    // never a step larger than its neighbour's just because it happens to be a date.
    case 'Date':
      return (
        <FormField label={field.label} required={field.required} error={error}>
          {(control) => (
            <Input {...control.aria} type="date" value={value} readOnly={disabled} onChange={(e) => onChange(e.target.value)} />
          )}
        </FormField>
      );

    case 'Number':
    case 'Currency':
    case 'Percentage':
      return (
        <FormField label={field.label} required={field.required} error={error}>
          {(control) => (
            <Input
              {...control.aria}
              value={value}
              inputMode="decimal"
              readOnly={disabled}
              leading={field.dataType === 'Currency' && field.unit ? <span>{field.unit}</span> : undefined}
              trailing={field.dataType !== 'Currency' && field.unit ? <span>{field.unit}</span> : undefined}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </FormField>
      );

    default:
      return (
        <FormField label={field.label} required={field.required} error={error}>
          {(control) => (
            <Input
              {...control.aria}
              value={value}
              readOnly={disabled}
              trailing={field.unit ? <span>{field.unit}</span> : undefined}
              onChange={(e) => onChange(e.target.value)}
            />
          )}
        </FormField>
      );
  }
}
