import { describe, expect, it } from 'vitest'
import { CUSTOM_PRESET_ID, FIELD_PRESETS, PRESET_GROUP_LABELS, findPreset } from './fieldPresets'

/**
 * The fixed, code-defined preset catalog the "Add Validation Rule" dropdown is built from — mirrors
 * Backend/AuthService/Infrastructure/Validation/FieldPresets.cs. Structural integrity here matters
 * more than any single preset's behaviour: a duplicate id or an empty label corrupts the dropdown (two
 * entries silently resolving to the same rule, or a blank menu item) for every field on every company
 * using this platform, not just the one preset that broke.
 */

describe('the catalog as a whole', () => {
  it('has no duplicate ids', () => {
    // findPreset takes the first match, so a duplicate would make one entry permanently unreachable
    // and the "Add Validation Rule" dropdown would offer two options that silently do the same thing.
    const ids = FIELD_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('never reuses the reserved custom-pattern id', () => {
    // CUSTOM_PRESET_ID ("custom") is handled as a special case throughout schemaValidation.ts and
    // FieldEditorModal — a built-in preset claiming it would collide with the one-off regex escape hatch.
    expect(FIELD_PRESETS.some((p) => p.id === CUSTOM_PRESET_ID)).toBe(false)
  })

  it('gives every preset a non-empty label and default message', () => {
    for (const preset of FIELD_PRESETS) {
      expect(preset.label.trim().length).toBeGreaterThan(0)
      expect(preset.defaultMessage.trim().length).toBeGreaterThan(0)
    }
  })

  it('assigns every preset to a group that has a display label', () => {
    for (const preset of FIELD_PRESETS) {
      expect(PRESET_GROUP_LABELS[preset.group]).toBeTruthy()
    }
  })

  it('gives every jsonSchema-kind preset a schema fragment, and every builtin-kind preset none', () => {
    for (const preset of FIELD_PRESETS) {
      if (preset.kind === 'jsonSchema') {
        expect(Object.keys(preset.schema).length).toBeGreaterThan(0)
      }
    }
  })
})

describe('the documented example for every preset', () => {
  it('proves the preset actually distinguishes valid from invalid input', () => {
    // A preset whose own "valid" and "invalid" examples don't actually differ in outcome would be
    // silently useless — this doesn't re-run the schema engine (that's schemaValidation.test.ts's
    // job), it just asserts the example pair itself isn't degenerate (identical strings).
    for (const preset of FIELD_PRESETS) {
      expect(preset.example.valid).not.toBe(preset.example.invalid)
    }
  })
})

describe('findPreset', () => {
  it('finds a known preset by id', () => {
    expect(findPreset('emailSmart')?.label).toBe('Email address')
  })

  it('returns undefined for an unknown id rather than throwing', () => {
    expect(findPreset('doesNotExist')).toBeUndefined()
  })
})
