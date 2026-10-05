import { describe, expect, it } from 'vitest'
import { hasVisibleField, isFieldVisible, type LeadFieldConfig } from './fieldControlRegistry'

/**
 * Which product-detail section a lead form shows.
 *
 * It used to be decided by the product's name ("Home Financing"), then by whether the product's config
 * happened to contain the field at all. Every sub-category's config now contains all the detail fields,
 * hidden until an administrator switches them on — so "is it in the config" no longer means "does it
 * apply", and the section must follow the visible flag.
 */

const row = (apiField: string, visible: boolean): LeadFieldConfig => ({
  id: apiField, catalogSubCategoryId: 's1', apiField, displayLabel: apiField, section: 'Product Details', displayOrder: 1,
  visible, required: false, editable: true, sensitive: false, maskingRule: 'None', visibleCharCount: 4, validations: [],
})

describe('hasVisibleField', () => {
  it('is false for a detail field that is configured but switched off', () => {
    expect(hasVisibleField([row('propertyType', false)], 'propertyType')).toBe(false)
  })

  it('is true once an administrator switches it on', () => {
    expect(hasVisibleField([row('propertyType', true)], 'propertyType')).toBe(true)
  })

  it('is false for a field that is not configured at all — unlike isFieldVisible, which shows fields before the config has loaded', () => {
    expect(hasVisibleField([], 'propertyType')).toBe(false)
    expect(isFieldVisible([], 'propertyType')).toBe(true)
  })
})
