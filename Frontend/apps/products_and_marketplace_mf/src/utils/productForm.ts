import { validateFieldValue } from '@omniconnect/ui/validation';
import type { FieldDefinition, ProductDetail } from '../types/domain';

/**
 * The product form's attribute logic, apart from any component.
 *
 * A product's attributes are defined by its sub-category, so the form has no fixed fields to check: it
 * asks each definition. The order matches the server's exactly — required, then the data type, then the
 * field's own format rules — so a value is refused for the same reason, in the same words, on either side.
 * The server still decides; this only saves the round trip.
 */

// Same grammar as the server's parse (invariant culture, thousands separators allowed): "8.35", "-4", "5,00,000".
const NUMBER = /^[+-]?(\d[\d,]*)(\.\d+)?$/;

/** A multi-select's value is its choices, comma-separated ("Lounge, Cashback"); options may not contain a comma. */
export const splitChoices = (value: string): string[] =>
  value.split(',').map((part) => part.trim()).filter(Boolean);

export const joinChoices = (choices: string[]): string => choices.join(', ');

function checkType(field: FieldDefinition, value: string): string | undefined {
  switch (field.dataType) {
    case 'Number':
    case 'Currency':
    case 'Percentage':
      return NUMBER.test(value) ? undefined : `${field.label} must be a number.`;

    case 'Boolean':
      return /^(true|false)$/i.test(value) ? undefined : `${field.label} must be true or false.`;

    case 'Date':
      return Number.isNaN(Date.parse(value)) ? `${field.label} must be a date.` : undefined;

    case 'Dropdown': {
      const options = field.options ?? [];
      return options.some((o) => o.toLowerCase() === value.toLowerCase()) ? undefined : `${field.label} must be one of: ${options.join(', ')}.`;
    }

    case 'MultiSelect': {
      const options = field.options ?? [];
      const unknown = splitChoices(value).find((choice) => !options.some((o) => o.toLowerCase() === choice.toLowerCase()));
      return unknown === undefined ? undefined : `"${unknown}" is not an option for ${field.label}. Choose from: ${options.join(', ')}.`;
    }

    default:
      return undefined;
  }
}

/** The message for a value that breaks its field's definition, or undefined when it is fine. */
export function validateProductField(field: FieldDefinition, rawValue: string | undefined): string | undefined {
  const value = (rawValue ?? '').trim();
  if (value === '') return field.required ? `${field.label} is required.` : undefined;

  const typeProblem = checkType(field, value);
  if (typeProblem) return typeProblem;

  // The field's own format rules, through the shared engine the server also runs.
  return validateFieldValue(
    { key: field.key, label: field.label, core: false, dataType: field.dataType, required: field.required, order: field.sortOrder, validations: field.validations },
    value,
  );
}

/** Every failing field, by field id — only the ones that failed. */
export function validateProductFields(fields: FieldDefinition[], values: Record<string, string>): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const message = validateProductField(field, values[field.id]);
    if (message) errors[field.id] = message;
  }
  return errors;
}

/** The form's starting values: an existing product's, keyed by field id, or empty. */
export function initialFieldValues(product: Pick<ProductDetail, 'detailFields' | 'cardFields'> | null): Record<string, string> {
  const values: Record<string, string> = {};
  for (const field of [...(product?.cardFields ?? []), ...(product?.detailFields ?? [])]) values[field.fieldDefinitionId] = field.value;
  return values;
}

/** What is sent: only the fields that have a value, trimmed. The server treats a missing field as blank. */
export function buildFieldValues(fields: FieldDefinition[], values: Record<string, string>): { fieldDefinitionId: string; value: string }[] {
  return fields
    .map((field) => ({ fieldDefinitionId: field.id, value: (values[field.id] ?? '').trim() }))
    .filter((entry) => entry.value !== '');
}

/**
 * The server's per-field answer (keyed by field key) placed on the fields it names.
 * Anything it could not place — a key this form does not know — is returned to be shown as a general message.
 */
export function placeServerErrors(fields: FieldDefinition[], serverErrors: Record<string, string>): { byField: Record<string, string>; unplaced: string[] } {
  const byKey = new Map(fields.map((f) => [f.key, f.id]));
  const byField: Record<string, string> = {};
  const unplaced: string[] = [];
  for (const [key, message] of Object.entries(serverErrors)) {
    const id = byKey.get(key);
    if (id) byField[id] = message;
    else unplaced.push(message);
  }
  return { byField, unplaced };
}
