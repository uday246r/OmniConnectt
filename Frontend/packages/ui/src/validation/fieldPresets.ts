/**
 * The validation preset catalog for admin-configurable user fields — drives the "Add Validation Rule"
 * dropdown in the Manage User Fields screen. Mirrors
 * Backend/AuthService/Infrastructure/Validation/FieldPresets.cs; keep the two in sync — a preset id
 * added on one side with no matching entry on the other silently stops validating on whichever side
 * was missed.
 *
 * Each preset is either:
 *  - `kind: 'jsonSchema'` — a fragment ajv (+ ajv-formats) compiles directly, or
 *  - `kind: 'builtin'` — reuses existing, already-tested logic (email near-miss check, phone shape)
 *    instead of reimplementing it as a regex.
 * "custom" is a third, special case handled directly by schemaValidation.ts: it never appears here
 * because it has no fixed pattern of its own — the admin supplies one per field.
 */

export type PresetGroup = 'textShape' | 'format' | 'length' | 'custom'

export interface JsonSchemaPreset {
  id: string
  kind: 'jsonSchema'
  group: PresetGroup
  label: string
  schema: Record<string, unknown>
  defaultMessage: string
  example: { valid: string; invalid: string }
}

export interface BuiltinPreset {
  id: string
  kind: 'builtin'
  group: PresetGroup
  label: string
  defaultMessage: string
  example: { valid: string; invalid: string }
}

export type FieldPreset = JsonSchemaPreset | BuiltinPreset

export const CUSTOM_PRESET_ID = 'custom'

export const FIELD_PRESETS: FieldPreset[] = [
  // --- Text shape ---
  {
    id: 'lettersOnly',
    kind: 'jsonSchema',
    group: 'textShape',
    label: 'Letters only',
    schema: { pattern: '^[A-Za-z]+$' },
    defaultMessage: 'Only letters are allowed.',
    example: { valid: 'Jane', invalid: 'Jane2' },
  },
  {
    id: 'lettersAndSpaces',
    kind: 'jsonSchema',
    group: 'textShape',
    label: 'Letters & spaces',
    schema: { pattern: '^[A-Za-z ]+$' },
    defaultMessage: 'Only letters and spaces are allowed.',
    example: { valid: 'Jane Smith', invalid: 'Jane Smith2' },
  },
  {
    id: 'alphanumeric',
    kind: 'jsonSchema',
    group: 'textShape',
    label: 'Alphanumeric',
    schema: { pattern: '^[A-Za-z0-9]+$' },
    defaultMessage: 'Only letters and numbers are allowed.',
    example: { valid: 'EMP1234', invalid: 'EMP-1234' },
  },
  {
    id: 'noSpecialCharacters',
    kind: 'jsonSchema',
    group: 'textShape',
    label: 'No special characters',
    schema: { pattern: '^[A-Za-z0-9 ]+$' },
    defaultMessage: 'Special characters are not allowed.',
    example: { valid: 'Room 4B', invalid: 'Room #4B!' },
  },
  {
    id: 'digitsOnly',
    kind: 'jsonSchema',
    group: 'textShape',
    label: 'Digits only',
    schema: { pattern: '^[0-9]+$' },
    defaultMessage: 'Only digits are allowed.',
    example: { valid: '12345', invalid: '123-45' },
  },

  // --- Format ---
  {
    id: 'emailSmart',
    kind: 'builtin',
    group: 'format',
    label: 'Email address',
    defaultMessage: 'Enter a valid email address.',
    example: { valid: 'jane@example.com', invalid: 'jane@example' },
  },
  {
    id: 'mobileIN',
    kind: 'builtin',
    group: 'format',
    label: 'Mobile number',
    defaultMessage: 'Enter a valid mobile number.',
    example: { valid: '+91 98765 43210', invalid: '12' },
  },
  {
    id: 'aadharFormat',
    kind: 'jsonSchema',
    group: 'format',
    label: 'Aadhar number',
    schema: { pattern: '^\\d{4}\\s?\\d{4}\\s?\\d{4}$' },
    defaultMessage: 'Enter a valid 12-digit Aadhar number.',
    example: { valid: '1234 5678 9012', invalid: '1234-5678' },
  },
  {
    id: 'panFormat',
    kind: 'jsonSchema',
    group: 'format',
    label: 'PAN number',
    schema: { pattern: '^[A-Z]{5}[0-9]{4}[A-Z]$' },
    defaultMessage: 'Enter a valid PAN number (e.g. ABCDE1234F).',
    example: { valid: 'ABCDE1234F', invalid: 'ABCDE1234' },
  },
  {
    id: 'pincode',
    kind: 'jsonSchema',
    group: 'format',
    label: 'Pincode',
    schema: { pattern: '^\\d{6}$' },
    defaultMessage: 'Enter a valid 6-digit pincode.',
    example: { valid: '400001', invalid: '4000' },
  },
  {
    id: 'url',
    kind: 'jsonSchema',
    group: 'format',
    label: 'Website URL',
    schema: { format: 'uri' },
    defaultMessage: 'Enter a valid URL, e.g. https://example.com',
    example: { valid: 'https://example.com', invalid: 'example' },
  },

  // --- Length ---
  {
    id: 'minLength',
    kind: 'jsonSchema',
    group: 'length',
    label: 'Minimum length',
    schema: { minLength: 1 },
    defaultMessage: 'This value is too short.',
    example: { valid: 'Abcdef', invalid: 'Ab' },
  },
  {
    id: 'maxLength',
    kind: 'jsonSchema',
    group: 'length',
    label: 'Maximum length',
    schema: { maxLength: 1 },
    defaultMessage: 'This value is too long.',
    example: { valid: 'Ab', invalid: 'Abcdef' },
  },
  {
    id: 'exactLength',
    kind: 'jsonSchema',
    group: 'length',
    label: 'Exact length',
    schema: { minLength: 1, maxLength: 1 },
    defaultMessage: 'This value must be a specific length.',
    example: { valid: 'Abcdef', invalid: 'Ab' },
  },
]

export function findPreset(id: string): FieldPreset | undefined {
  return FIELD_PRESETS.find((p) => p.id === id)
}

export const PRESET_GROUP_LABELS: Record<PresetGroup, string> = {
  textShape: 'Text shape',
  format: 'Format',
  length: 'Length',
  custom: 'Custom',
}
