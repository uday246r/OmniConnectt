import { describe, expect, it } from 'vitest'
import fixture from './__fixtures__/rule-parity.json'
import { FIELD_PRESETS } from './fieldPresets'
import { validateFieldValue, type CustomPreset, type FieldDefinition } from './schemaValidation'

/**
 * The browser's field-format engine against the table the server's engine is also held to.
 *
 * Every admin-configured format is checked in the form and again on the server. The two engines are
 * written in two languages and had drifted: "mailto:…" was a Website URL here and not there, "1,500"
 * failed a numeric range here and passed there, a 9-digit Indian mobile passed there and failed here.
 * Backend/AuthService.Tests/ValidationParityTests.cs runs these same rows against
 * Backend/Shared/OmniConnect.Validation, so a disagreement fails a build on whichever side changed.
 */

interface FixtureCase {
  rule: { type: string; pattern?: string; value?: number }
  value: string
  valid: boolean
  note?: string
}

const presets = fixture.presets as unknown as CustomPreset[]
const cases = fixture.cases as FixtureCase[]

describe('rule parity with the server', () => {
  it.each(cases.map((c, i) => [i, c] as const))('case %i', (_, testCase) => {
    const field: FieldDefinition = {
      key: 'f',
      label: 'Field',
      core: false,
      required: false,
      dataType: 'text',
      order: 0,
      validations: [{ type: testCase.rule.type, pattern: testCase.rule.pattern, value: testCase.rule.value, message: 'failed' }],
    }

    const failure = validateFieldValue(field, testCase.value, presets)

    expect(failure === undefined, `${testCase.rule.type} on "${testCase.value}". ${testCase.note ?? ''}`).toBe(testCase.valid)
  })

  it('covers every built-in preset', () => {
    const covered = new Set(cases.map((c) => c.rule.type))

    expect(FIELD_PRESETS.map((p) => p.id).filter((id) => !covered.has(id))).toEqual([])
  })
})
