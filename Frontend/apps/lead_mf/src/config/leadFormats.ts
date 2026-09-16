import {
  COUNTRY_PHONE_LIST,
  findCountry,
  splitDialCode,
  validateFieldValue,
  type CountryPhoneConfig,
  type CustomPreset,
  type FieldDefinition,
} from '@omniremit/ui/validation'
import type { LeadFormData } from '../types/lead'
import type { LeadFieldConfig } from './fieldControlRegistry'

/**
 * Checking a lead's fields against the formats configured for them in Field Settings.
 *
 * One implementation. The IC number, phone and email checks used to be written out three times in
 * the form store (field blur, create, edit) as fixed regexes, and a fourth time on the server; none of
 * them could use a format an administrator defined in Settings → Manage Formats. The rules now come
 * from the field configuration and are evaluated by the platform's shared engine — the same one user
 * fields use, and the same one LeadService runs again on save.
 */

/** The form calls the catalog's `branch` field `preferredBranch`; every other name is shared. */
export const formFieldFor = (apiField: string): keyof LeadFormData =>
  (apiField === 'branch' ? 'preferredBranch' : apiField) as keyof LeadFormData

export const apiFieldFor = (formField: string): string => (formField === 'preferredBranch' ? 'branch' : formField)

/**
 * "+60" and "12-345 6789" → "+60 12-345 6789". A number that already carries its own country code
 * (older records were saved that way) is not prefixed twice. Mirrors LeadFieldConfigService.ComposePhone.
 */
export function composePhone(countryCode: string, number: string): string {
  const code = countryCode.trim()
  let national = number.trim()
  while (code && national.startsWith(code)) national = national.slice(code.length).trimStart()
  return `${code} ${national}`.trim()
}

/** The value a format is checked against: the phone number with its country code, anything else as typed. */
export function formatValueFor(apiField: string, form: LeadFormData): string {
  if (apiField === 'phoneNumber') {
    return form.phoneNumber.trim() ? composePhone(form.phoneCountryCode, form.phoneNumber) : ''
  }
  const value = form[formFieldFor(apiField)]
  return typeof value === 'string' ? value : ''
}

/** The field's first unmet format, or undefined. Empty values pass — whether a field may be empty is Required's job. */
export function formatErrorFor(
  config: LeadFieldConfig[],
  apiField: string,
  form: LeadFormData,
  presets: CustomPreset[],
): string | undefined {
  const field = config.find((f) => f.apiField === apiField)
  if (!field?.validations?.length) return undefined

  const definition: FieldDefinition = {
    key: apiField,
    label: field.displayLabel,
    core: false,
    required: false,
    dataType: 'text',
    order: field.displayOrder,
    validations: field.validations,
  }
  return validateFieldValue(definition, formatValueFor(apiField, form), presets)
}

/**
 * Every format error on the form, keyed by the form's own field names.
 *
 * @param original On an edit, the lead as it was opened. A value left unchanged is not re-checked —
 *   the server does the same — so tightening a format later does not make every older lead
 *   impossible to edit until someone retypes a value nobody asked them to change.
 */
export function formatErrorsFor(
  config: LeadFieldConfig[],
  form: LeadFormData,
  presets: CustomPreset[],
  original?: LeadFormData,
): Partial<Record<keyof LeadFormData, string>> {
  const errors: Partial<Record<keyof LeadFormData, string>> = {}
  for (const field of config) {
    if (original && formatValueFor(field.apiField, form) === formatValueFor(field.apiField, original)) continue
    const message = formatErrorFor(config, field.apiField, form, presets)
    if (message) errors[formFieldFor(field.apiField)] = message
  }
  return errors
}

/**
 * The country a new lead's phone number starts in — `VITE_DEFAULT_PHONE_COUNTRY` (an ISO code such as
 * "MY"), falling back to Malaysia, where this remote was first deployed. Never a code baked into markup.
 */
export function defaultPhoneCountry(): CountryPhoneConfig {
  const configured = (import.meta.env.VITE_DEFAULT_PHONE_COUNTRY as string | undefined)?.trim().toUpperCase()
  return COUNTRY_PHONE_LIST.find((c) => c.code === configured) ?? findCountry('MY')
}

/** A stored phone ("+65 8123 4567") split back into the country picker's code and the number box's value. */
export function splitStoredPhone(stored: string | null | undefined): { phoneCountryCode: string; phoneNumber: string } {
  const trimmed = (stored ?? '').trim()
  if (!trimmed.startsWith('+')) return { phoneCountryCode: defaultPhoneCountry().dialCode, phoneNumber: trimmed }

  const { countryCode, nationalNumber } = splitDialCode(trimmed)
  const dialCode = findCountry(countryCode).dialCode
  // Older rows repeat the code ("+60 +60 12-345 6789"); the number box should not.
  let national = nationalNumber
  while (national.startsWith(dialCode)) national = national.slice(dialCode.length).trimStart()
  return { phoneCountryCode: dialCode, phoneNumber: national }
}
