import { describe, expect, it } from 'vitest'
import {
  COUNTRY_PHONE_LIST,
  DEFAULT_COUNTRY_CODE,
  composePhone,
  findCountry,
  splitDialCode,
  validateCountryPhone,
  validateFullPhone,
} from './phone'

/**
 * Phone numbers, which every service in the platform stores and validates.
 *
 * Worth testing carefully for an unglamorous reason: a phone rule that is too strict silently locks
 * real customers out of being recorded, and one that is too loose lets an unreachable number into the
 * database where nobody finds out until someone tries to call it. Both failures are quiet.
 *
 * The trickiest part is `splitDialCode`, because dial codes are ambiguous prefixes of one another.
 */

const india = findCountry('IN')
const singapore = findCountry('SG')
const uk = findCountry('GB')

describe('findCountry', () => {
  it('finds a country by its ISO code', () => {
    expect(findCountry('SG').dialCode).toBe('+65')
  })

  it('falls back to the first entry rather than returning nothing', () => {
    // Callers use the result immediately; returning undefined would make every call site handle a
    // case that only arises from a typo.
    expect(findCountry('ZZ')).toBe(COUNTRY_PHONE_LIST[0])
    expect(findCountry(null)).toBe(COUNTRY_PHONE_LIST[0])
    expect(findCountry(undefined)).toBe(COUNTRY_PHONE_LIST[0])
  })
})

describe('splitDialCode', () => {
  it('splits a stored number into its country and national parts', () => {
    expect(splitDialCode('+65 81234567')).toEqual({ countryCode: 'SG', nationalNumber: '81234567' })
  })

  it('prefers the longest matching dial code', () => {
    /*
     * The reason the list is sorted before matching. `+9` is not a country, but `+91` (India) and
     * `+971` (UAE) both begin with it — and `+971` begins with `+97`. Matching in list order would
     * let a shorter code claim a longer one's numbers, quietly filing every UAE number under India.
     */
    expect(splitDialCode('+971 501234567').countryCode).toBe('AE')
    expect(splitDialCode('+91 9876543210').countryCode).toBe('IN')
  })

  it('keeps an unrecognised number editable rather than rejecting it', () => {
    // Existing records predate this list. Refusing to split one would make it impossible to open the
    // record and correct it — the opposite of helpful.
    expect(splitDialCode('12345')).toEqual({
      countryCode: DEFAULT_COUNTRY_CODE,
      nationalNumber: '12345',
    })
  })

  it('treats an absent value as an empty national number for the default country', () => {
    for (const value of [null, undefined, '', '   ']) {
      expect(splitDialCode(value)).toEqual({
        countryCode: DEFAULT_COUNTRY_CODE,
        nationalNumber: '',
      })
    }
  })
})

describe('validateCountryPhone', () => {
  it('accepts a correct national number', () => {
    expect(validateCountryPhone('9876543210', india)).toBeUndefined()
  })

  it('accepts the formatting people actually type', () => {
    // Digits are counted, not characters — so spaces, dashes and brackets are cosmetic and a number
    // pasted from a contact card still validates.
    expect(validateCountryPhone('98765 43210', india)).toBeUndefined()
    expect(validateCountryPhone('98765-43210', india)).toBeUndefined()
  })

  it('requires a value', () => {
    expect(validateCountryPhone('', india)).toBeDefined()
    expect(validateCountryPhone('   ', india)).toBeDefined()
    expect(validateCountryPhone(null, india)).toBeDefined()
  })

  it('rejects letters', () => {
    expect(validateCountryPhone('98765abcde', india)).toBeDefined()
  })

  it('rejects formatting with no digits behind it', () => {
    expect(validateCountryPhone('---', india)).toBeDefined()
  })

  it('says how many digits were entered, not just that it is wrong', () => {
    // "Requires exactly 10 digits (9 entered)" is actionable; "invalid phone number" is not.
    const message = validateCountryPhone('987654321', india)

    expect(message).toContain('10')
    expect(message).toContain('9 entered')
  })

  it('enforces an exact length where a country has one', () => {
    expect(validateCountryPhone('8123456', singapore)).toBeDefined()
    expect(validateCountryPhone('81234567', singapore)).toBeUndefined()
    expect(validateCountryPhone('812345678', singapore)).toBeDefined()
  })

  it('accepts a range where a country has one', () => {
    // The UK is 10 or 11; treating every country as fixed-length would reject half of them.
    expect(validateCountryPhone('7911123456', uk)).toBeUndefined()
    expect(validateCountryPhone('79111234567', uk)).toBeUndefined()
    expect(validateCountryPhone('791112345', uk)).toBeDefined()
  })
})

describe('validateFullPhone', () => {
  it('validates a stored number that carries its own dial code', () => {
    expect(validateFullPhone('+65 81234567')).toBeUndefined()
  })

  it('rejects a number that is the wrong length for the country it names', () => {
    expect(validateFullPhone('+65 812')).toBeDefined()
  })

  it('requires a value', () => {
    expect(validateFullPhone(null)).toBeDefined()
    expect(validateFullPhone('')).toBeDefined()
  })

  it('validates an unrecognised dial code against the default country', () => {
    // Not silently accepted. A number with no known dial code still has to be a plausible length.
    expect(validateFullPhone('+999 1')).toBeDefined()
  })
})

describe('composePhone and splitDialCode are inverses', () => {
  it('round-trips every country in the list', () => {
    /*
     * The property that matters in practice: a number saved through the picker must reopen in the
     * same picker showing the same country. If composing and splitting disagree for any entry, that
     * country's numbers silently reopen as another country's — and the digit rules applied on the
     * next edit would be the wrong ones.
     */
    for (const country of COUNTRY_PHONE_LIST) {
      const national = '1'.repeat(country.minDigits)
      const { countryCode, nationalNumber } = splitDialCode(composePhone(country, national))

      expect(findCountry(countryCode).dialCode).toBe(country.dialCode)
      expect(nationalNumber).toBe(national)
    }
  })

  it('trims what it composes', () => {
    expect(composePhone(india, '  9876543210  ')).toBe('+91 9876543210')
  })
})

describe('the country list itself', () => {
  it('has no duplicate ISO codes', () => {
    // findCountry takes the first match, so a duplicate would make one entry permanently unreachable.
    const codes = COUNTRY_PHONE_LIST.map((c) => c.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('declares a sane digit range for every country', () => {
    for (const country of COUNTRY_PHONE_LIST) {
      expect(country.minDigits).toBeGreaterThan(0)
      expect(country.maxDigits).toBeGreaterThanOrEqual(country.minDigits)
    }
  })

  it('has a placeholder that would itself validate', () => {
    // The placeholder is the example an operator copies the shape of. One that fails the rule beside
    // it is actively misleading.
    for (const country of COUNTRY_PHONE_LIST) {
      expect(validateCountryPhone(country.placeholder, country)).toBeUndefined()
    }
  })

  it('contains the default country', () => {
    expect(COUNTRY_PHONE_LIST.some((c) => c.code === DEFAULT_COUNTRY_CODE)).toBe(true)
  })
})
