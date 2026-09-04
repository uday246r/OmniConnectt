import { describe, expect, it } from 'vitest'
import { filterInputMode, filterTypeBlockedMessage, sanitizeFilterInput } from './filterInput'

/**
 * Restricting a filter field to the shape of the column it filters.
 *
 * The value here is not validation — it is preventing a class of search that silently returns
 * nothing. Typing a letter into an IC-number filter matches no rows, and an empty result is
 * indistinguishable from "there are none", so the operator concludes the data is missing rather than
 * that the query was wrong. Refusing the keystroke is what makes that impossible.
 *
 * The punctuation each type allows is the part worth pinning: too strict and real values cannot be
 * typed at all.
 */

describe('numeric columns', () => {
  it('keeps digits', () => {
    expect(sanitizeFilterInput('12345', 'numeric')).toBe('12345')
  })

  it('drops letters', () => {
    expect(sanitizeFilterInput('12a34b5', 'numeric')).toBe('12345')
  })

  it('keeps the punctuation these columns are actually formatted with', () => {
    // An IC number, a date and an IP address all live in numeric columns and none of them are bare
    // digits. Stripping their separators would make the real value untypable.
    expect(sanitizeFilterInput('900101-01-5432', 'numeric')).toBe('900101-01-5432')
    expect(sanitizeFilterInput('2026-09-04', 'numeric')).toBe('2026-09-04')
    expect(sanitizeFilterInput('192.168.0.1', 'numeric')).toBe('192.168.0.1')
    expect(sanitizeFilterInput('+60 12 345 6789', 'numeric')).toBe('60 12 345 6789')
  })

  it('drops symbols that are not part of any of those formats', () => {
    expect(sanitizeFilterInput('12@34#5', 'numeric')).toBe('12345')
  })
})

describe('alphabetic columns', () => {
  it('keeps letters and spaces', () => {
    expect(sanitizeFilterInput('Ahmad Bin Ali', 'alpha')).toBe('Ahmad Bin Ali')
  })

  it('drops digits', () => {
    expect(sanitizeFilterInput('Ahmad123', 'alpha')).toBe('Ahmad')
  })

  it('keeps the punctuation real names contain', () => {
    // O'Brien and Smith-Jones are names people actually have; a name filter that cannot spell them
    // is broken for exactly the users least able to work around it.
    expect(sanitizeFilterInput("O'Brien", 'alpha')).toBe("O'Brien")
    expect(sanitizeFilterInput('Smith-Jones', 'alpha')).toBe('Smith-Jones')
    expect(sanitizeFilterInput('Jr. Watson', 'alpha')).toBe('Jr. Watson')
  })
})

describe('plain text columns', () => {
  it('accepts anything, because the column does', () => {
    const messy = "abc 123 !@# 'x' -_-"
    expect(sanitizeFilterInput(messy, 'text')).toBe(messy)
  })
})

describe('every type', () => {
  it('leaves an empty value empty rather than inventing one', () => {
    expect(sanitizeFilterInput('', 'numeric')).toBe('')
    expect(sanitizeFilterInput('', 'alpha')).toBe('')
    expect(sanitizeFilterInput('', 'text')).toBe('')
  })

  it('is idempotent — sanitising an already-clean value changes nothing', () => {
    // It runs on every keystroke, so a second pass over its own output must be a no-op or characters
    // would erode as the user keeps typing.
    for (const type of ['numeric', 'alpha', 'text'] as const) {
      const once = sanitizeFilterInput("Ahmad-123 O'x", type)
      expect(sanitizeFilterInput(once, type)).toBe(once)
    }
  })
})

describe('the surrounding affordances', () => {
  it('opens the numeric keyboard for a numeric column', () => {
    expect(filterInputMode('numeric')).toBe('numeric')
    expect(filterInputMode('alpha')).toBe('text')
    expect(filterInputMode('text')).toBe('text')
  })

  it('explains a refused keystroke, except where nothing is refused', () => {
    // Silently swallowing a character is the worst outcome: the operator sees their typing vanish
    // with no explanation.
    expect(filterTypeBlockedMessage('numeric')).not.toBe('')
    expect(filterTypeBlockedMessage('alpha')).not.toBe('')
    expect(filterTypeBlockedMessage('text')).toBe('')
  })
})
