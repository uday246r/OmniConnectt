import { describe, expect, it } from 'vitest'
import type { CustomPreset, ValidationRule } from '@omniremit/ui/validation'
import type { LeadFormData } from '../types/lead'
import type { LeadFieldConfig } from './fieldControlRegistry'
import { composePhone, formatErrorFor, formatErrorsFor, splitStoredPhone } from './leadFormats'

/**
 * Lead fields checked against the formats configured for them in Field Settings.
 *
 * The IC number, phone and email checks were fixed regexes written out three times in the form store,
 * could not use a format from Settings → Manage Formats, and checked every phone as if it were
 * Malaysian. These pin that the rules come from the field configuration, that a Manage Formats format
 * works by its key, that the phone is checked for the country picked, and that editing an older lead
 * does not re-check values nobody changed.
 */

const form = (over: Partial<LeadFormData> = {}): LeadFormData => ({
  product: 'Home Financing', customerName: 'Asha', icNumber: '880512-14-5678', phoneCountryCode: '+60',
  phoneNumber: '12-345 6789', email: 'asha@example.com', state: 'Selangor', preferredBranch: '', employerName: 'Acme',
  appliedAmount: '50000', hasPreferredSalesExecutive: false, preferredSalesExecutive: '', propertyType: '',
  propertyStatus: '', dateOfIncorporation: '', companyName: '', entityType: '', marketingConsent: 'CONSENT',
  agreedToPrivacyPolicy: true, ...over,
})

const field = (apiField: string, validations: ValidationRule[]): LeadFieldConfig => ({
  id: apiField, productId: 'p', apiField, displayLabel: apiField, section: 's', displayOrder: 1, visible: true,
  required: true, editable: true, sensitive: false, maskingRule: 'None', visibleCharCount: 4, validations,
})

const defaults: LeadFieldConfig[] = [
  field('icNumber', [{ type: 'custom', pattern: '^[0-9]{6}-[0-9]{2}-[0-9]{4}$', message: 'Use YYMMDD-PB-XXXX.' }]),
  field('phoneNumber', [{ type: 'mobileIN', message: 'Enter a valid phone number for the selected country.' }]),
  field('email', [{ type: 'emailSmart', message: 'Enter a valid email address.' }]),
]

describe('formats from Field Settings', () => {
  it('pass a lead in the configured formats', () => {
    expect(formatErrorsFor(defaults, form(), [])).toEqual({})
  })

  it('name each field that is out of format, with its own message', () => {
    const errors = formatErrorsFor(defaults, form({ icNumber: '8805121456', email: 'asha@gmail.comsss' }), [])

    expect(errors).toEqual({ icNumber: 'Use YYMMDD-PB-XXXX.', email: 'Enter a valid email address.' })
  })

  it('check the phone number for the country picked', () => {
    expect(formatErrorFor(defaults, 'phoneNumber', form({ phoneCountryCode: '+65', phoneNumber: '8123 4567' }), [])).toBeUndefined()
    expect(formatErrorFor(defaults, 'phoneNumber', form({ phoneCountryCode: '+65', phoneNumber: '12-345 6789' }), [])).toBeDefined()
  })

  it('apply a Manage Formats format by its key', () => {
    const presets: CustomPreset[] = [{ key: 'companyCode', label: 'Company code', kind: 'regex', pattern: '^CO-[0-9]{4}$', message: 'x' }]
    const config = [field('employerName', [{ type: 'companyCode', message: 'Use CO-0000.' }])]

    expect(formatErrorFor(config, 'employerName', form({ employerName: 'Acme' }), presets)).toBe('Use CO-0000.')
    expect(formatErrorFor(config, 'employerName', form({ employerName: 'CO-0042' }), presets)).toBeUndefined()
  })

  it('leave an empty value to the Required check', () => {
    expect(formatErrorsFor(defaults, form({ icNumber: '', email: '' }), [])).toEqual({})
  })

  it('do not re-check a value left unchanged on an older lead', () => {
    const opened = form({ icNumber: '88051214567' })

    expect(formatErrorsFor(defaults, form({ icNumber: '88051214567', email: 'new@example.com' }), [], opened)).toEqual({})
    expect(formatErrorsFor(defaults, form({ icNumber: '88051214568' }), [], opened)).toHaveProperty('icNumber')
  })
})

describe('phone numbers', () => {
  it('are composed without repeating a country code already typed', () => {
    expect(composePhone('+60', '12-345 6789')).toBe('+60 12-345 6789')
    expect(composePhone('+60', '+60 12-345 6789')).toBe('+60 12-345 6789')
  })

  it('are split back into the picker and the number box when a lead is edited', () => {
    expect(splitStoredPhone('+65 8123 4567')).toEqual({ phoneCountryCode: '+65', phoneNumber: '8123 4567' })
    expect(splitStoredPhone('+60 +60 12-345 6789')).toEqual({ phoneCountryCode: '+60', phoneNumber: '12-345 6789' })
  })
})
