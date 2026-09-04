/**
 * What kind of value a free-text filter field is allowed to hold — matched to the underlying
 * column's own data type, not left as unrestricted free-form text by default.
 */
export type FilterInputType = 'numeric' | 'alpha' | 'text'

/**
 * Restricts what a filter input accepts to match its column's data type: a column that only ever
 * holds digits (an IC number, a phone number, an account number) should not accept letters, and a
 * person's name column should not accept digits. Applied on every keystroke rather than only at
 * submit time, so the field refuses the character instead of accepting it and failing validation —
 * or silently matching nothing — later.
 */
export function sanitizeFilterInput(value: string, type: FilterInputType): string {
  switch (type) {
    case 'numeric':
      // Digits plus the punctuation these columns are actually formatted with — an IC number's
      // YYMMDD-PB-XXXX, a date's YYYY-MM-DD, an IPv4 address's dotted quads, spacing in a phone
      // number — never letters.
      return value.replace(/[^0-9.\-\s]/g, '')
    case 'alpha':
      // Letters, spaces, and the punctuation real names use (O'Brien, Smith-Jones) — never digits.
      return value.replace(/[^A-Za-z\s.'-]/g, '')
    default:
      return value
  }
}

/** The matching HTML `inputMode` — a numeric filter should open the numeric keyboard on mobile too. */
export function filterInputMode(type: FilterInputType): 'text' | 'numeric' {
  return type === 'numeric' ? 'numeric' : 'text'
}

/**
 * What to tell the operator when a keystroke was refused — shown next to the input rather than
 * failing silently, so "why won't it let me type that" has an answer right there.
 */
export function filterTypeBlockedMessage(type: FilterInputType): string {
  switch (type) {
    case 'numeric':
      return 'Only numbers are allowed here.'
    case 'alpha':
      return 'Only letters are allowed here.'
    default:
      return ''
  }
}
