/**
 * Built-in templates for user profile custom fields.
 * Includes contact templates (with comprehensive list of all countries), organization templates,
 * and general profile templates.
 */

export interface FieldTemplate {
  id: string
  category: 'contact' | 'organization' | 'general' | 'custom' | string
  name: string
  label: string
  key?: string
  dataType: 'text' | 'dropdown'
  description?: string
  options?: string[]
  isSystem?: boolean
  /** A section KEY (not a label) the field editor preselects — honoured only if that section still exists. */
  defaultSection?: string
}

import { Country } from 'country-state-city'

export const ALL_COUNTRIES: string[] = Country.getAllCountries().map((c) => c.name)

export const ALL_PHONE_CODES: string[] = Country.getAllCountries().map((c) => {
  const code = c.phonecode.startsWith('+') ? c.phonecode : `+${c.phonecode}`
  return `${c.name} (${code})`
})

export const FIELD_TEMPLATES: FieldTemplate[] = [
  {
    id: 'contact-country',
    category: 'contact',
    name: 'Country (Contact Template)',
    label: 'Country',
    key: 'country',
    dataType: 'dropdown',
    description: 'Searchable dropdown containing all countries of the world (via country-state-city)',
    options: ALL_COUNTRIES,
    isSystem: true,
    defaultSection: 'address',
  },
  {
    id: 'contact-state',
    category: 'contact',
    name: 'State / Province (Contact Template)',
    label: 'State / Province',
    key: 'stateProvince',
    dataType: 'dropdown',
    description: 'Cascading state/province dropdown dynamically filtered by selected country (via country-state-city)',
    options: [],
    isSystem: true,
    defaultSection: 'address',
  },
  {
    id: 'contact-city',
    category: 'contact',
    name: 'City (Contact Template)',
    label: 'City',
    key: 'city',
    dataType: 'dropdown',
    description: 'Cascading city dropdown dynamically filtered by selected state and country (via country-state-city)',
    options: [],
    isSystem: true,
    defaultSection: 'address',
  },
  {
    id: 'contact-postal-code',
    category: 'contact',
    name: 'Postal / ZIP Code (Contact Template)',
    label: 'Postal / ZIP Code',
    key: 'postalCode',
    dataType: 'text',
    description: 'Input field for postal / zip code with country-aware validation (via postcode-validator)',
    options: [],
    isSystem: true,
    defaultSection: 'address',
  },
]

export const TEMPLATE_CATEGORIES: { id: string; label: string }[] = [
  { id: 'contact', label: 'Contact Templates' },
  { id: 'custom', label: 'Custom Templates' },
]

let dynamicTemplates: FieldTemplate[] | null = null

export function setCatalogTemplates(templates: FieldTemplate[]) {
  dynamicTemplates = templates
}

export function getCatalogTemplates(): FieldTemplate[] {
  return dynamicTemplates ?? FIELD_TEMPLATES
}

export function getTemplateById(id: string): FieldTemplate | undefined {
  const normalizedId = id === 'contact-address' ? 'contact-street-address' : id
  if (dynamicTemplates) {
    const found = dynamicTemplates.find((t) => t.id === normalizedId || (id === 'contact-address' && t.id === 'contact-address'))
    if (found) return found
  }
  return FIELD_TEMPLATES.find((t) => t.id === normalizedId || (id === 'contact-address' && t.id === 'contact-street-address'))
}


