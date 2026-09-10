import { describe, expect, it } from 'vitest'
import { isEmailSmart } from './emailSmart'

/**
 * The "Email address" preset's check — kept as its own small module (not imported from
 * apps/host/src/shared/validation/rules.ts) so packages/ui has no dependency on the host app. Ported
 * from Backend/AuthService/Infrastructure/Validation/EmailSmartValidator.cs — a value this accepts or
 * rejects must match what the server decides for the same submission.
 */

describe('isEmailSmart', () => {
  it('accepts a well-formed email', () => {
    expect(isEmailSmart('jane@example.com')).toBe(true)
    expect(isEmailSmart('jane.smith+work@example.co.uk')).toBe(true)
  })

  it('rejects a malformed email', () => {
    expect(isEmailSmart('jane@example')).toBe(false)
    expect(isEmailSmart('not-an-email')).toBe(false)
    expect(isEmailSmart('@example.com')).toBe(false)
  })

  it('rejects a near-miss of a common domain even though the shape is syntactically valid', () => {
    // No regex can prove ".comsssssssss" is not a real TLD — it IS a well-formed label. This is
    // exactly the case the near-miss check exists for.
    expect(isEmailSmart('ashok246@gmail.comsssssssss')).toBe(false)
    expect(isEmailSmart('jane@yahoo.co.injunk')).toBe(false)
  })

  it('accepts an exact match of a common domain', () => {
    expect(isEmailSmart('jane@gmail.com')).toBe(true)
    expect(isEmailSmart('jane@rediffmail.com')).toBe(true)
  })

  it('does not penalise a domain that merely contains a common domain as a substring', () => {
    expect(isEmailSmart('jane@mygmail.com.example.org')).toBe(true)
  })
})
