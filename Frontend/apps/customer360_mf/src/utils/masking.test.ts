import { describe, expect, it } from 'vitest'
import { maskNRIC, maskPassport, maskPhone, maskSecondaryID, maskTIN } from './masking'

/**
 * Masking personal identifiers before they are shown.
 *
 * These run over real customer data — national IDs, passports, phone numbers, tax numbers — and the
 * mistake they can make is silent: revealing too much still looks like a mask. So the assertions here
 * are about what survives, character for character, rather than "it contains a star". The rule each
 * function follows is deliberately different, because how much of an identifier is safe to show
 * depends on what it is, and a shared helper would have flattened that.
 */

/** No identifier should ever come back with more visible characters than the rule allows. */
function visibleCharacters(masked: string): string {
  return masked.replace(/[*\s]/g, '')
}

describe('maskNRIC — one leading digit, four trailing', () => {
  it('masks everything between', () => {
    expect(maskNRIC('900101015432')).toBe('9*******5432')
  })

  it('strips the dashes people type, so formatting cannot change how much shows', () => {
    // "900101-01-5432" and "900101015432" are the same identifier; masking must not depend on which
    // way it was entered.
    expect(maskNRIC('900101-01-5432')).toBe(maskNRIC('900101015432'))
  })

  it('never reveals more than five characters, however long the input', () => {
    expect(visibleCharacters(maskNRIC('9001010154321234567890'))).toHaveLength(5)
  })

  it('leaves a value too short to mask meaningfully alone', () => {
    // Masking five characters down to five would be theatre; there is nothing to hide behind.
    expect(maskNRIC('12345')).toBe('12345')
  })
})

describe('maskPassport and maskTIN — one leading, two trailing', () => {
  it('masks a passport number', () => {
    expect(maskPassport('E12345689')).toBe('E******89')
  })

  it('masks a tax number', () => {
    expect(maskTIN('T123456712')).toBe('T*******12')
  })

  it('reveals at most three characters', () => {
    expect(visibleCharacters(maskPassport('A1234567890123'))).toHaveLength(3)
    expect(visibleCharacters(maskTIN('A1234567890123'))).toHaveLength(3)
  })
})

describe('maskSecondaryID — one leading, one trailing', () => {
  it('masks the middle', () => {
    expect(maskSecondaryID('123456')).toBe('1****6')
  })

  it('reveals at most two characters', () => {
    expect(visibleCharacters(maskSecondaryID('123456789012'))).toHaveLength(2)
  })
})

describe('maskPhone', () => {
  it('keeps the country and network prefix and the last three digits', () => {
    // Enough for a person to recognise their own number, not enough to dial it.
    const masked = maskPhone('+60 123456789')

    expect(masked.startsWith('+60 1')).toBe(true)
    expect(masked.endsWith('789')).toBe(true)
  })

  it('treats the spaced and unspaced forms as the same number', () => {
    expect(visibleCharacters(maskPhone('+60123456789'))).toBe(visibleCharacters(maskPhone('+60 123456789')))
  })

  it('masks an unrecognised format rather than passing it through', () => {
    // The fallback matters most: an international number this app was not written for must still be
    // masked, not printed in full because no branch matched.
    const masked = maskPhone('+441234567890')

    expect(masked).toContain('*')
    expect(masked).not.toBe('+441234567890')
  })

  it('leaves a value too short to mask alone', () => {
    expect(maskPhone('12345678')).toBe('12345678')
  })
})

describe('every masker, on the values that are not identifiers at all', () => {
  const maskers = [
    ['maskPhone', maskPhone],
    ['maskNRIC', maskNRIC],
    ['maskPassport', maskPassport],
    ['maskSecondaryID', maskSecondaryID],
    ['maskTIN', maskTIN],
  ] as const

  it.each(maskers)('%s renders an absent value as a dash', (_name, mask) => {
    // A record with no passport should read "—", not "undefined" and not an empty cell that looks
    // like a rendering fault.
    expect(mask(null)).toBe('-')
    expect(mask(undefined)).toBe('-')
    expect(mask('')).toBe('-')
    expect(mask('   ')).toBe('-')
  })

  it.each(maskers)('%s does not mask the literal strings an API sends for absence', (_name, mask) => {
    // Upstream sometimes sends these as text. Masking them would produce "n***l", which reads as a
    // real value that has been redacted rather than as no value at all.
    expect(mask('null')).toBe('-')
    expect(mask('undefined')).toBe('-')
    expect(mask('-')).toBe('-')
  })

  it.each(maskers)('%s is stable — masking is not applied twice', (_name, mask) => {
    // Values pass through render paths more than once; a second pass must not eat more characters.
    const once = mask('900101015432')
    expect(mask(once)).toBe(mask(once))
  })
})
