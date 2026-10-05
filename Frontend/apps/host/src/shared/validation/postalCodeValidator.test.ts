import { describe, expect, it } from 'vitest'
import { getCountryIsoCode, validatePostalCode } from './postalCodeValidator'

describe('postalCodeValidator', () => {
  describe('getCountryIsoCode', () => {
    it('returns ISO code for 2-letter codes', () => {
      expect(getCountryIsoCode('IN')).toBe('IN')
      expect(getCountryIsoCode('us')).toBe('US')
      expect(getCountryIsoCode('GB')).toBe('GB')
    })

    it('returns ISO code for country full names', () => {
      expect(getCountryIsoCode('India')).toBe('IN')
      expect(getCountryIsoCode('United States')).toBe('US')
      expect(getCountryIsoCode('United Kingdom')).toBe('GB')
    })

    it('returns ISO code for country names with dial code format (e.g. from phone lists)', () => {
      expect(getCountryIsoCode('India (+91)')).toBe('IN')
      expect(getCountryIsoCode('United States (+1)')).toBe('US')
    })

    it('returns undefined for empty, whitespace, or invalid values', () => {
      expect(getCountryIsoCode('')).toBeUndefined()
      expect(getCountryIsoCode('   ')).toBeUndefined()
      expect(getCountryIsoCode(undefined)).toBeUndefined()
      expect(getCountryIsoCode('UnknownCountry12345')).toBeUndefined()
    })
  })

  describe('validatePostalCode', () => {
    it('returns valid true for empty or whitespace inputs (optional field handling)', () => {
      expect(validatePostalCode('')).toEqual({ valid: true })
      expect(validatePostalCode('   ')).toEqual({ valid: true })
      expect(validatePostalCode('', 'India')).toEqual({ valid: true })
    })

    it('validates Indian PIN codes (6 digits, space-tolerant)', () => {
      expect(validatePostalCode('560001', 'India')).toEqual({ valid: true })
      expect(validatePostalCode('560 001', 'India')).toEqual({ valid: true })
      expect(validatePostalCode('110001', 'India (+91)')).toEqual({ valid: true })

      expect(validatePostalCode('123', 'India').valid).toBe(false)
      expect(validatePostalCode('56000', 'India').valid).toBe(false)
      expect(validatePostalCode('ABCDEF', 'India').valid).toBe(false)
    })

    it('validates US ZIP codes (5 digits or 9 digits ZIP+4)', () => {
      expect(validatePostalCode('90210', 'United States')).toEqual({ valid: true })
      expect(validatePostalCode('90210-1234', 'United States')).toEqual({ valid: true })
      expect(validatePostalCode('123', 'United States').valid).toBe(false)
    })

    it('validates UK postcodes', () => {
      expect(validatePostalCode('SW1A 1AA', 'United Kingdom')).toEqual({ valid: true })
      expect(validatePostalCode('SW1A1AA', 'United Kingdom')).toEqual({ valid: true })
      expect(validatePostalCode('1234', 'United Kingdom').valid).toBe(false)
    })

    it('falls back to generic alphanumeric validation when no country is provided', () => {
      expect(validatePostalCode('12345')).toEqual({ valid: true })
      expect(validatePostalCode('AB-123')).toEqual({ valid: true })
      expect(validatePostalCode('12').valid).toBe(false)
      expect(validatePostalCode('1234567890123').valid).toBe(false)
    })
  })
})
