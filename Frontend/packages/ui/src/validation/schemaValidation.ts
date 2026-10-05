import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { CUSTOM_PRESET_ID, findPreset } from './fieldPresets'
import { isEmailSmart } from './emailSmart'
import { validateFullPhone } from './phone'

/**
 * Admin-configurable user field schema — the frontend mirror of
 * Backend/AuthService/Application/DTOs/UserFieldSchemaDtos.cs. Field/rule shapes must match the JSON
 * the API actually sends (camelCase, via System.Text.Json's default web naming policy).
 */
export interface ValidationRule {
  type: string
  pattern?: string | null
  value?: number | null
  message: string
}

export interface FieldDefinition {
  key: string
  label: string
  core: boolean
  dataType: string
  required: boolean
  /** Position WITHIN the field's section (1..n per section), not across the whole form. */
  order: number
  validations: ValidationRule[]
  options?: string[]
  template?: string
  /**
   * The key of the section this field belongs to, resolved against the admin-managed Field Sections
   * catalog (`/api/field-sections`). Older schemas may carry a section's display label, or nothing; both
   * are resolved server-side and by the host's `resolveSectionKey`. The rule engine itself is
   * section-agnostic — this only affects layout.
   */
  section?: string
}

export interface UserFieldSchema {
  fields: FieldDefinition[]
  version: number
  updatedAt: string
}

/**
 * An admin-defined, reusable "format" from Settings > Manage Formats — the frontend mirror of
 * Backend/AuthService/Application/DTOs/ValidationPresetDtos.cs. Unlike the fixed catalog in
 * fieldPresets.ts, these are fully admin-owned (creatable, editable, deletable) and referenced from a
 * field's ValidationRule by `type === key`.
 */
export type CustomPresetKind = 'regex' | 'lengthRange' | 'numericRange' | 'textPattern'

/** Character-class choices for the "textPattern" kind — the non-regex "string" option. Mirrors
 * Backend/AuthService/Infrastructure/Validation/FieldPresets.TextPatternModes. */
export type TextPatternMode = 'lettersOnly' | 'lettersAndSpaces' | 'alphanumeric' | 'noSpecialCharacters' | 'digitsOnly'

export interface CustomPreset {
  key: string
  label: string
  kind: CustomPresetKind
  pattern?: string | null
  minLength?: number | null
  maxLength?: number | null
  minValue?: number | null
  maxValue?: number | null
  textMode?: TextPatternMode | null
  message: string
}

export interface ValidationPresetCatalog {
  presets: CustomPreset[]
  version: number
  updatedAt: string
}

const ajv = new Ajv({ allErrors: false, strict: false })
addFormats(ajv)

/** One AJV validator per distinct jsonSchema-kind preset, compiled once and reused. */
const compiledPresetCache = new Map<string, ReturnType<typeof ajv.compile>>()

function compilePresetSchema(presetId: string): ReturnType<typeof ajv.compile> | undefined {
  const preset = findPreset(presetId)
  if (!preset || preset.kind !== 'jsonSchema') return undefined

  const cached = compiledPresetCache.get(presetId)
  if (cached) return cached

  const compiled = ajv.compile({ type: 'string', ...preset.schema })
  compiledPresetCache.set(presetId, compiled)
  return compiled
}

/** Applies one admin-defined "Manage Formats" preset — mirrors UserSchemaValidator.EvaluateCustomPreset. */
function evaluateCustomPreset(preset: CustomPreset, value: string): boolean {
  switch (preset.kind) {
    case 'regex': {
      if (!preset.pattern) return true
      try {
        return new RegExp(preset.pattern).test(value)
      } catch {
        return true // an invalid admin-authored regex must not block every submission
      }
    }
    case 'lengthRange': {
      if (preset.minLength != null && value.length < preset.minLength) return false
      if (preset.maxLength != null && value.length > preset.maxLength) return false
      return true
    }
    case 'numericRange': {
      const num = parsePlainNumber(value)
      if (num === undefined) return false
      if (preset.minValue != null && num < preset.minValue) return false
      if (preset.maxValue != null && num > preset.maxValue) return false
      return true
    }
    case 'textPattern': {
      const regex = preset.textMode ? TEXT_PATTERN_REGEXES[preset.textMode] : undefined
      return regex ? regex.test(value) : true
    }
    default:
      return true
  }
}

const PLAIN_NUMBER = /^[+-]?[0-9]+(\.[0-9]+)?$/

/**
 * A plain decimal number, with optional thousands separators: "1500", "-2.5", "1,500.75".
 *
 * `Number()` used to decide this, which refuses "1,500" and accepts "1e3", "0x10" and "" (as 0) —
 * while the server accepted "1,500". Both sides now accept exactly this shape (FieldRuleEngine.TryParseNumber).
 */
export function parsePlainNumber(value: string): number | undefined {
  const compact = value.trim().replace(/,/g, '')
  return PLAIN_NUMBER.test(compact) ? Number(compact) : undefined
}

/** A web address people can open: absolute, http or https, with a host. Mirrors FieldPresets.IsAbsoluteUrl. */
export function isWebsiteUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname.length > 0
  } catch {
    return false
  }
}

const TEXT_PATTERN_REGEXES: Record<TextPatternMode, RegExp> = {
  lettersOnly: /^[A-Za-z]+$/,
  lettersAndSpaces: /^[A-Za-z ]+$/,
  alphanumeric: /^[A-Za-z0-9]+$/,
  noSpecialCharacters: /^[A-Za-z0-9 ]+$/,
  digitsOnly: /^[0-9]+$/,
}

/**
 * Evaluates one rule against one value. Returns the rule's message on failure, undefined on success.
 * `value` should already be non-empty — checking "is it required" is the caller's job (see
 * validateFieldValue), since an empty optional field has nothing to validate.
 */
export function evaluateRule(rule: ValidationRule, value: string, customPresets: CustomPreset[] = []): string | undefined {
  switch (rule.type) {
    case 'emailSmart':
      return isEmailSmart(value) ? undefined : rule.message
    case 'mobileIN':
      return validateFullPhone(value) === undefined ? undefined : rule.message
    case 'url':
      return isWebsiteUrl(value) ? undefined : rule.message
    case 'minLength':
      return value.length >= (rule.value ?? 0) ? undefined : rule.message
    case 'maxLength':
      return value.length <= (rule.value ?? Number.MAX_SAFE_INTEGER) ? undefined : rule.message
    case 'exactLength':
      // No length configured is nothing to enforce, rather than "must be undefined characters long".
      return rule.value == null || value.length === rule.value ? undefined : rule.message
    case CUSTOM_PRESET_ID: {
      if (!rule.pattern) return undefined
      try {
        return new RegExp(rule.pattern).test(value) ? undefined : rule.message
      } catch {
        // An admin-authored pattern that fails to compile must not crash the form for everyone
        // submitting this field — surfaced instead in the builder's own live tester (see
        // testCustomPattern), which is where an invalid regex should actually be caught.
        return undefined
      }
    }
    default: {
      const custom = customPresets.find((p) => p.key === rule.type)
      if (custom) {
        return evaluateCustomPreset(custom, value) ? undefined : rule.message
      }
      const validator = compilePresetSchema(rule.type)
      if (!validator) return undefined // unknown/stale preset id — fail open, see backend counterpart
      return validator(value) ? undefined : rule.message
    }
  }
}

/** One field's value against its full rule list — stops at the first failure, mirroring the
 * backend's one-problem-at-a-time behavior so the two never disagree about which message wins. */
export function validateFieldValue(
  field: FieldDefinition,
  rawValue: string | null | undefined,
  customPresets: CustomPreset[] = [],
): string | undefined {
  const value = rawValue?.trim()

  if (field.required && !value) {
    return `${field.label} is required.`
  }

  if (!value) {
    return undefined
  }

  if (field.dataType === 'dropdown' && field.options && field.options.length > 0) {
    const match = field.options.some((opt) => opt.toLowerCase() === value.toLowerCase())
    if (!match) {
      return `Please select a valid option for ${field.label}.`
    }
  }

  for (const rule of field.validations) {
    const message = evaluateRule(rule, value, customPresets)
    if (message) return message
  }

  return undefined
}

/** Whole-form validation — fieldKey -> error message, only for fields that actually failed. */
export function validateFields(
  fields: FieldDefinition[],
  values: Record<string, string | null | undefined>,
  customPresets: CustomPreset[] = [],
): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const field of fields) {
    const message = validateFieldValue(field, values[field.key], customPresets)
    if (message) errors[field.key] = message
  }
  return errors
}

/**
 * Live-tester support for the "Add Validation Rule" builder UI — tests a single candidate rule
 * against a sample value the admin types, so they can confirm it behaves before saving. Returns
 * `{ ok: true }`, `{ ok: false, message }`, or `{ ok: false, message, patternError: true }` if a
 * custom regex itself doesn't compile.
 */
export function testRule(
  rule: ValidationRule,
  sampleValue: string,
  customPresets: CustomPreset[] = [],
): { ok: boolean; message?: string; patternError?: boolean } {
  if (rule.type === CUSTOM_PRESET_ID) {
    if (!rule.pattern) return { ok: true }
    try {
      // eslint-disable-next-line no-new -- validity check only
      new RegExp(rule.pattern)
    } catch {
      return { ok: false, message: 'This pattern is not valid regular expression syntax.', patternError: true }
    }
  }

  const message = evaluateRule(rule, sampleValue, customPresets)
  return message ? { ok: false, message } : { ok: true }
}

/**
 * Live-tester support for the "Manage Formats" builder — tests a candidate custom preset directly
 * (before it has a `type` key that could appear in a ValidationRule), same result shape as `testRule`.
 */
export function testCustomPreset(preset: CustomPreset, sampleValue: string): { ok: boolean; message?: string; patternError?: boolean } {
  if (preset.kind === 'regex') {
    if (!preset.pattern) return { ok: true }
    try {
      // eslint-disable-next-line no-new -- validity check only
      new RegExp(preset.pattern)
    } catch {
      return { ok: false, message: 'This pattern is not valid regular expression syntax.', patternError: true }
    }
  }

  return evaluateCustomPreset(preset, sampleValue) ? { ok: true } : { ok: false, message: preset.message }
}
