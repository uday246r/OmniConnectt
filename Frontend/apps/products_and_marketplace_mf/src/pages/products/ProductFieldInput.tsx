import { Checkbox, Input, Select, Switch } from '@omniconnect/ui';
import { Field } from '../../components/form/Field';
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
        <Field label={field.label} required={field.required} error={error}>
          <Switch aria-label={field.label} checked={value.toLowerCase() === 'true'} disabled={disabled} onChange={(e) => onChange(e.target.checked ? 'true' : 'false')} />
        </Field>
      );

    case 'Dropdown':
      return (
        <Field label={field.label} required={field.required} error={error}>
          <Select
            aria-label={field.label}
            options={(field.options ?? []).map((o) => ({ value: o, label: o }))}
            value={value}
            placeholder={`Choose ${field.label.toLowerCase()}`}
            clearLabel={field.required ? undefined : 'None'}
            disabled={disabled}
            onChange={(e) => onChange(e.target.value)}
          />
        </Field>
      );

    case 'MultiSelect': {
      const chosen = new Set(splitChoices(value).map((c) => c.toLowerCase()));
      const toggle = (option: string, on: boolean) => {
        const next = (field.options ?? []).filter((o) => (o === option ? on : chosen.has(o.toLowerCase())));
        onChange(joinChoices(next));
      };
      return (
        <Field label={field.label} required={field.required} error={error}>
          <div className={styles.choices}>
            {(field.options ?? []).map((option) => (
              <Checkbox key={option} label={option} checked={chosen.has(option.toLowerCase())} disabled={disabled} onChange={(e) => toggle(option, e.target.checked)} />
            ))}
          </div>
        </Field>
      );
    }

    case 'Date':
      return <Input label={field.label} type="date" value={value} required={field.required} readOnly={disabled} errorText={error} onChange={(e) => onChange(e.target.value)} />;

    case 'Number':
    case 'Currency':
    case 'Percentage':
      return (
        <Input
          label={field.label}
          value={value}
          inputMode="decimal"
          required={field.required}
          readOnly={disabled}
          errorText={error}
          leading={field.dataType === 'Currency' && field.unit ? <span>{field.unit}</span> : undefined}
          trailing={field.dataType !== 'Currency' && field.unit ? <span>{field.unit}</span> : undefined}
          onChange={(e) => onChange(e.target.value)}
        />
      );

    default:
      return <Input label={field.label} value={value} required={field.required} readOnly={disabled} errorText={error} trailing={field.unit ? <span>{field.unit}</span> : undefined} onChange={(e) => onChange(e.target.value)} />;
  }
}
