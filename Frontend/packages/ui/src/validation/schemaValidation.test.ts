import { describe, expect, it } from 'vitest'
import {
  evaluateRule,
  testCustomPreset,
  testRule,
  validateFields,
  validateFieldValue,
  type CustomPreset,
  type FieldDefinition,
  type ValidationRule,
} from './schemaValidation'

/**
 * The client-side half of the admin-configurable user field schema engine — the AJV-backed mirror of
 * Backend/AuthService/Infrastructure/Validation/UserSchemaValidator.cs. This is what a non-technical
 * admin's rule choices actually DO: a built-in preset, a one-off custom regex on a field, or a named
 * "Manage Formats" preset resolved by key. A mismatch here from the backend's own logic means the form
 * shows green while the server rejects the same value (or the reverse), which is exactly the kind of
 * silent disagreement this file exists to prevent.
 */

function field(over: Partial<FieldDefinition> & Pick<FieldDefinition, 'key' | 'label'>): FieldDefinition {
  return { core: false, dataType: 'text', required: true, order: 1, validations: [], ...over }
}

function rule(over: Partial<ValidationRule> & Pick<ValidationRule, 'type' | 'message'>): ValidationRule {
  return { pattern: null, value: null, ...over }
}

describe('evaluateRule — built-in presets', () => {
  it('passes a value that matches a jsonSchema-kind preset', () => {
    expect(evaluateRule(rule({ type: 'lettersAndSpaces', message: 'Letters and spaces only.' }), 'Jane Doe')).toBeUndefined()
  })

  it('returns the rule message for a value that fails the preset', () => {
    expect(evaluateRule(rule({ type: 'lettersAndSpaces', message: 'Letters and spaces only.' }), 'Jane2')).toBe(
      'Letters and spaces only.',
    )
  })

  it('emailSmart rejects a near-miss domain the same way the backend preset does', () => {
    expect(evaluateRule(rule({ type: 'emailSmart', message: 'Enter a valid email.' }), 'ashok@gmail.comsssssssss')).toBe(
      'Enter a valid email.',
    )
  })

  it('mobileIN delegates to the shared phone validator', () => {
    expect(evaluateRule(rule({ type: 'mobileIN', message: 'Invalid.' }), '+91 98765 43210')).toBeUndefined()
    expect(evaluateRule(rule({ type: 'mobileIN', message: 'Invalid.' }), '123')).toBe('Invalid.')
  })

  it.each([
    ['minLength', 5, 'ab', 'Too short.'],
    ['maxLength', 5, 'abcdef', 'Too long.'],
    ['exactLength', 5, 'abcd', 'Wrong length.'],
  ] as const)('%s enforces its configured bound (%s chars, "%s")', (type, value, input, message) => {
    expect(evaluateRule(rule({ type, message, value }), input)).toBe(message)
  })

  it('an unrecognised preset id fails open rather than blocking the value', () => {
    // A preset id that exists only in a newer/older catalog must never brick every submission on a
    // field that references it — see the identical guarantee on the backend.
    expect(evaluateRule(rule({ type: 'somePresetThatDoesNotExist', message: 'Should never surface.' }), 'anything')).toBeUndefined()
  })
})

describe('evaluateRule — one-off custom regex', () => {
  it('applies the pattern carried on the rule itself', () => {
    const r = rule({ type: 'custom', message: 'Use format EMP-0001.', pattern: '^EMP-[0-9]{4}$' })

    expect(evaluateRule(r, 'EMP-0001')).toBeUndefined()
    expect(evaluateRule(r, 'EMP-1')).toBe('Use format EMP-0001.')
  })

  it('an invalid regex pattern fails open instead of throwing', () => {
    const r = rule({ type: 'custom', message: 'Invalid.', pattern: '[unclosed' })

    expect(evaluateRule(r, 'anything')).toBeUndefined()
  })

  it('a custom rule with no pattern configured accepts anything', () => {
    const r = rule({ type: 'custom', message: 'Invalid.', pattern: null })

    expect(evaluateRule(r, 'anything')).toBeUndefined()
  })
})

describe('evaluateRule — Manage Formats custom presets', () => {
  const employeeCode: CustomPreset = {
    key: 'employeeCode',
    label: 'Employee Code',
    kind: 'regex',
    pattern: '^EMP-[0-9]{4}$',
    message: 'Use format EMP-0001.',
  }

  const employeeIdRange: CustomPreset = {
    key: 'employeeIdRange',
    label: 'Employee ID Range',
    kind: 'numericRange',
    minValue: 1000,
    maxValue: 5000,
    message: 'Must be between 1000 and 5000.',
  }

  const codeLength: CustomPreset = {
    key: 'codeLength',
    label: 'Code Length',
    kind: 'lengthRange',
    minLength: 3,
    maxLength: 8,
    message: 'Wrong length.',
  }

  const companyNameFormat: CustomPreset = {
    key: 'companyNameFormat',
    label: 'Company Name Format',
    kind: 'textPattern',
    textMode: 'lettersAndSpaces',
    message: 'Letters and spaces only.',
  }

  it('resolves a regex-kind custom preset by key', () => {
    const r = rule({ type: 'employeeCode', message: 'Use format EMP-0001.' })

    expect(evaluateRule(r, 'EMP-0001', [employeeCode])).toBeUndefined()
    expect(evaluateRule(r, 'EMP-1', [employeeCode])).toBe('Use format EMP-0001.')
  })

  it.each([
    ['999', false],
    ['1000', true],
    ['5000', true],
    ['5001', false],
  ])('numericRange bounds the value as a number (%s -> pass=%s)', (value, shouldPass) => {
    const r = rule({ type: 'employeeIdRange', message: 'Must be between 1000 and 5000.' })

    expect(evaluateRule(r, value, [employeeIdRange]) === undefined).toBe(shouldPass)
  })

  it('numericRange rejects a non-numeric value', () => {
    const r = rule({ type: 'employeeIdRange', message: 'Must be between 1000 and 5000.' })

    expect(evaluateRule(r, 'not-a-number', [employeeIdRange])).toBeDefined()
  })

  it.each([
    ['ab', false],
    ['abcde', true],
    ['abcdefghijk', false],
  ])('lengthRange bounds the character count (%s -> pass=%s)', (value, shouldPass) => {
    const r = rule({ type: 'codeLength', message: 'Wrong length.' })

    expect(evaluateRule(r, value, [codeLength]) === undefined).toBe(shouldPass)
  })

  it.each([
    ['Acme Corp', true],
    ['Acme123', false],
  ])('textPattern applies the chosen character class (%s -> pass=%s)', (value, shouldPass) => {
    const r = rule({ type: 'companyNameFormat', message: 'Letters and spaces only.' })

    expect(evaluateRule(r, value, [companyNameFormat]) === undefined).toBe(shouldPass)
  })

  it('a deleted custom preset still referenced by a rule fails open', () => {
    const r = rule({ type: 'deletedPreset', message: 'Should never surface.' })

    expect(evaluateRule(r, 'anything', [])).toBeUndefined()
  })
})

describe('validateFieldValue', () => {
  it('a required field left empty reports "<label> is required."', () => {
    const f = field({ key: 'aadharNumber', label: 'Aadhar Number', required: true })

    expect(validateFieldValue(f, '')).toBe('Aadhar Number is required.')
    expect(validateFieldValue(f, null)).toBe('Aadhar Number is required.')
    expect(validateFieldValue(f, undefined)).toBe('Aadhar Number is required.')
  })

  it('an optional field left empty has no rules applied to nothing entered', () => {
    const f = field({
      key: 'nickname',
      label: 'Nickname',
      required: false,
      validations: [rule({ type: 'lettersOnly', message: 'Letters only.' })],
    })

    expect(validateFieldValue(f, '')).toBeUndefined()
  })

  it('stops at the first failing rule, mirroring the backend one-problem-at-a-time behaviour', () => {
    const f = field({
      key: 'code',
      label: 'Employee Code',
      validations: [
        rule({ type: 'lettersOnly', message: 'Letters only.' }),
        rule({ type: 'maxLength', message: 'Too long.', value: 3 }),
      ],
    })

    expect(validateFieldValue(f, 'TOOLONG123')).toBe('Letters only.')
  })

  it('trims the value before checking it', () => {
    const f = field({ key: 'name', label: 'Full Name', required: true })

    expect(validateFieldValue(f, '   ')).toBe('Full Name is required.')
  })
})

describe('validateFields', () => {
  it('only returns entries for fields that actually failed', () => {
    const fields = [
      field({ key: 'name', label: 'Full Name', required: true }),
      field({ key: 'email', label: 'Email Address', required: true }),
    ]

    const errors = validateFields(fields, { name: 'Jane', email: '' })

    expect(errors).toEqual({ email: 'Email Address is required.' })
    expect(errors.name).toBeUndefined()
  })

  it('returns an empty object when every field passes', () => {
    const fields = [field({ key: 'name', label: 'Full Name', required: true })]

    expect(validateFields(fields, { name: 'Jane' })).toEqual({})
  })
})

describe('testRule — the "Add Validation Rule" builder live tester', () => {
  it('reports pass/fail the same way evaluateRule does', () => {
    const r = rule({ type: 'lettersOnly', message: 'Letters only.' })

    expect(testRule(r, 'Jane')).toEqual({ ok: true })
    expect(testRule(r, 'Jane2')).toEqual({ ok: false, message: 'Letters only.' })
  })

  it('flags an invalid custom pattern distinctly, with patternError:true', () => {
    const r = rule({ type: 'custom', message: 'Invalid.', pattern: '[unclosed' })

    const result = testRule(r, 'anything')

    expect(result.ok).toBe(false)
    expect(result.patternError).toBe(true)
  })

  it('a custom rule with no pattern yet is treated as passing (nothing to test)', () => {
    const r = rule({ type: 'custom', message: 'Invalid.', pattern: null })

    expect(testRule(r, 'anything')).toEqual({ ok: true })
  })
})

describe('testCustomPreset — the "Manage Formats" builder live tester', () => {
  it('reports pass/fail for a candidate preset before it has a rule type key', () => {
    const preset: CustomPreset = { key: 'x', label: 'X', kind: 'regex', pattern: '^[0-9]+$', message: 'Digits only.' }

    expect(testCustomPreset(preset, '12345')).toEqual({ ok: true })
    expect(testCustomPreset(preset, 'abc')).toEqual({ ok: false, message: 'Digits only.' })
  })

  it('flags an invalid regex pattern distinctly', () => {
    const preset: CustomPreset = { key: 'x', label: 'X', kind: 'regex', pattern: '[unclosed', message: 'Invalid.' }

    const result = testCustomPreset(preset, 'anything')

    expect(result.ok).toBe(false)
    expect(result.patternError).toBe(true)
  })
})
