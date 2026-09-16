import type { ValidationRule } from '@omniconnect/ui/validation'

/**
 * A field's backend config (label/visibility/required/editable/order/sensitive/masking) says nothing
 * about which INPUT CONTROL renders it — Customer360's FieldConfig doesn't need this either, since it
 * only ever drives read-only display. Lead's Create/Edit forms need real inputs, so this is a small,
 * static, non-admin-configurable lookup — the same "kept out of the DB" philosophy
 * DynamicProfileSection.tsx already uses for its icon lookups, extended to input kind here instead.
 */
export type FieldControlKind = 'text' | 'number' | 'select' | 'searchable-select' | 'date' | 'checkbox'

export interface FieldControlDescriptor {
  kind: FieldControlKind
  optionsSource?: 'states' | 'branches' | 'salesExecutives' | 'propertyTypes' | 'propertyStatuses' | 'entityTypes'
}

export const FIELD_CONTROL_REGISTRY: Record<string, FieldControlDescriptor> = {
  customerName: { kind: 'text' },
  icNumber: { kind: 'text' },
  phoneNumber: { kind: 'text' },
  email: { kind: 'text' },
  state: { kind: 'searchable-select', optionsSource: 'states' },
  branch: { kind: 'searchable-select', optionsSource: 'branches' },
  employerName: { kind: 'text' },
  appliedAmount: { kind: 'number' },
  hasPreferredSalesExecutive: { kind: 'checkbox' },
  preferredSalesExecutive: { kind: 'searchable-select', optionsSource: 'salesExecutives' },
  propertyType: { kind: 'select', optionsSource: 'propertyTypes' },
  propertyStatus: { kind: 'select', optionsSource: 'propertyStatuses' },
  dateOfIncorporation: { kind: 'date' },
  companyName: { kind: 'text' },
  entityType: { kind: 'select', optionsSource: 'entityTypes' },
  marketingConsent: { kind: 'checkbox' },
  agreedToPrivacyPolicy: { kind: 'checkbox' },
}

export interface LeadFieldConfig {
  id: string
  productId: string
  apiField: string
  displayLabel: string
  section: string
  displayOrder: number
  visible: boolean
  required: boolean
  editable: boolean
  sensitive: boolean
  maskingRule: 'None' | 'HideFirstShowLast' | 'HideLastShowFirst' | 'HideMiddleShowFirstAndLast' | 'FullMask'
  visibleCharCount: number
  /** The field's format rules — built-in presets, Manage Formats keys, or one-off patterns. See config/leadFormats.ts. */
  validations: ValidationRule[]
}

function findField(config: LeadFieldConfig[], apiField: string): LeadFieldConfig | undefined {
  return config.find((f) => f.apiField === apiField)
}

/** True when the field is absent from config entirely (nothing configured yet — e.g. before the
 * config has loaded) so callers default to showing it rather than hiding fields on a fetch race. */
export function isFieldVisible(config: LeadFieldConfig[], apiField: string): boolean {
  const field = findField(config, apiField)
  return field ? field.visible : true
}

export function isFieldRequired(config: LeadFieldConfig[], apiField: string): boolean {
  return findField(config, apiField)?.required ?? false
}

export function isFieldEditable(config: LeadFieldConfig[], apiField: string): boolean {
  return findField(config, apiField)?.editable ?? true
}

export function getFieldLabel(config: LeadFieldConfig[], apiField: string, fallback: string): string {
  return findField(config, apiField)?.displayLabel || fallback
}
