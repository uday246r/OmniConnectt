import { describe, expect, it } from 'vitest'
import type { PasswordPolicy } from '../api/passwordPolicyApi'
import { buildPolicy, describeComplexity, isDirty, toDraft, type PolicyDraft } from './policyDraft'

/**
 * The browser-side twin of PasswordPolicyAppService's guards. It matters that they agree: the admin
 * should be stopped at the field, in the server's own words, not after a save round-trip. The other
 * property worth pinning is that a half-typed number is never coerced — an empty expiry box must be an
 * error, not a silent 0, because 0 means "passwords never expire".
 */

const saved: PasswordPolicy = {
  expiryDays: 90,
  roleExpiries: [{ roleId: 'role-a', expiryDays: 30 }],
  complexity: {
    minimumLength: 12, maximumLength: 128, requireUppercase: true, requireLowercase: true,
    requireDigit: true, requireNonAlphanumeric: true, rejectSameAsCurrent: true,
  },
  notifications: { email: true, inApp: true, leadDays: [14, 7, 3, 1] },
}

const roles = ['role-a', 'role-b']
const draft = (over: Partial<PolicyDraft> = {}): PolicyDraft => ({ ...toDraft(saved), ...over })

describe('toDraft / buildPolicy round trip', () => {
  it('rebuilds exactly the policy it was made from', () => {
    const { policy, errors } = buildPolicy(toDraft(saved), roles)

    expect(errors.roles).toEqual({})
    expect(policy).toEqual(saved)
  })

  it('holds numbers as text so a half-typed value is never coerced to a number mid-keystroke', () => {
    expect(typeof toDraft(saved).expiryDays).toBe('string')
  })
})

describe('global expiry', () => {
  it('treats an empty box as an error rather than 0, because 0 would silently switch expiry off', () => {
    const { policy, errors } = buildPolicy(draft({ expiryDays: '' }), roles)

    expect(policy).toBeNull()
    expect(errors.expiryDays).toMatch(/whole number/i)
  })

  it.each(['-1', '1.5', 'abc', '3651'])('rejects %s', (value) => {
    expect(buildPolicy(draft({ expiryDays: value }), roles).errors.expiryDays).toBeDefined()
  })

  it('accepts 0 as "never expires" — the explicit off switch — and skips the reminder-ordering check', () => {
    const { policy, errors } = buildPolicy(draft({ expiryDays: '0', leadDays: [] }), roles)

    expect(errors.expiryDays).toBeUndefined()
    expect(policy?.expiryDays).toBe(0)
  })
})

describe('password length', () => {
  it.each([['5', '128'], ['65', '128'], ['x', '128']])('rejects a minimum of %s', (min, max) => {
    expect(buildPolicy(draft({ minimumLength: min, maximumLength: max }), roles).errors.minimumLength).toBeDefined()
  })

  it('rejects a maximum below the minimum, and above 256', () => {
    expect(buildPolicy(draft({ minimumLength: '20', maximumLength: '12' }), roles).errors.maximumLength).toBeDefined()
    expect(buildPolicy(draft({ maximumLength: '257' }), roles).errors.maximumLength).toBeDefined()
  })
})

describe('reminders', () => {
  it('refuses a reminder on or after the day the password already expires', () => {
    expect(buildPolicy(draft({ expiryDays: '30', leadDays: [30] }), roles).errors.leadDays).toMatch(/sooner/i)
  })

  it('refuses more than five reminder days', () => {
    expect(buildPolicy(draft({ expiryDays: '365', leadDays: [30, 21, 14, 7, 3, 1] }), roles).errors.leadDays).toMatch(/at most 5/i)
  })

  it('stores reminder days distinct and largest first whatever order they were added in', () => {
    expect(buildPolicy(draft({ leadDays: [3, 14, 3, 7] }), roles).policy?.notifications.leadDays).toEqual([14, 7, 3])
  })
})

describe('role expiries', () => {
  it('sends no row for a blank role — blank means inherit the global value', () => {
    const { policy } = buildPolicy(draft({ roleDays: { 'role-a': '', 'role-b': '   ' } }), roles)

    expect(policy?.roleExpiries).toEqual([])
  })

  it('refuses 0 for a role, since a stray 0 would silently disable expiry for everyone holding it', () => {
    const { policy, errors } = buildPolicy(draft({ roleDays: { 'role-a': '0' } }), roles)

    expect(policy).toBeNull()
    expect(errors.roles['role-a']).toMatch(/1 to 3650/)
  })

  it('reports each bad role on its own row and still accepts the good ones', () => {
    const { errors } = buildPolicy(draft({ roleDays: { 'role-a': 'x', 'role-b': '45' } }), roles)

    expect(errors.roles['role-a']).toBeDefined()
    expect(errors.roles['role-b']).toBeUndefined()
  })

  it('ignores a value typed for a role that no longer exists', () => {
    const { policy } = buildPolicy(draft({ roleDays: { ghost: '10' } }), roles)

    expect(policy?.roleExpiries.map((r) => r.roleId)).not.toContain('ghost')
  })
})

describe('isDirty', () => {
  it('is false for an untouched draft', () => {
    expect(isDirty(toDraft(saved), saved)).toBe(false)
  })

  it('is false when a role row is cleared and re-blanked, since blank rows carry no information', () => {
    const untouched = { ...toDraft(saved), roleDays: { ...toDraft(saved).roleDays, 'role-b': '' } }

    expect(isDirty(untouched, saved)).toBe(false)
  })

  it('is false when reminder days are merely re-ordered', () => {
    expect(isDirty(draft({ leadDays: [1, 3, 7, 14] }), saved)).toBe(false)
  })

  it.each<Partial<PolicyDraft>>([
    { expiryDays: '60' },
    { requireDigit: false },
    { email: false },
    { leadDays: [7, 3, 1] },
    { roleDays: { 'role-a': '31' } },
    { roleDays: {} },
  ])('is true after a real change: %j', (change) => {
    expect(isDirty(draft(change), saved)).toBe(true)
  })
})

describe('describeComplexity', () => {
  it('lists exactly the switched-on rules', () => {
    expect(describeComplexity({ minimumLength: 10, requireUppercase: true, requireLowercase: false, requireDigit: true, requireNonAlphanumeric: false }))
      .toBe('Password must contain at least 10 characters, an uppercase letter and a digit.')
  })

  it('degrades to a length-only sentence when every class is off', () => {
    expect(describeComplexity({ minimumLength: 8, requireUppercase: false, requireLowercase: false, requireDigit: false, requireNonAlphanumeric: false }))
      .toBe('Password must be at least 8 characters.')
  })
})
