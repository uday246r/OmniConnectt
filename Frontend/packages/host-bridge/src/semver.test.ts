import { describe, expect, it } from 'vitest'
import parity from './__fixtures__/semver-parity.json'
import { checkRemoteCompatibility } from './compatibility'
import { satisfies } from './semver'

/**
 * The host's compatibility check against the table AuthService's check also runs
 * (SemVerParityTests.cs). The server refuses to promote what the host would refuse to mount; if the
 * two ever disagreed, a promoted remote would never load, or a loadable one would be refused.
 */
describe('satisfies (shared parity table)', () => {
  it.each(parity.cases)('$version against "$range" → $expected', ({ version, range, expected }) => {
    expect(satisfies(version, range)).toBe(expected)
  })
})

describe('checkRemoteCompatibility', () => {
  it('accepts a remote whose range the host satisfies', () => {
    expect(checkRemoteCompatibility({ requiredHostBridge: '^1.0.0' }, '1.1.0')).toEqual({ compatible: true })
  })

  it('refuses one it does not, naming both versions', () => {
    const verdict = checkRemoteCompatibility({ requiredHostBridge: '^2.0.0' }, '1.1.0')
    expect(verdict.compatible).toBe(false)
    expect(!verdict.compatible && verdict.reason).toContain('^2.0.0')
    expect(!verdict.compatible && verdict.reason).toContain('1.1.0')
  })

  it('accepts a remote built before the contract was versioned', () => {
    expect(checkRemoteCompatibility(undefined, '1.1.0').compatible).toBe(true)
    expect(checkRemoteCompatibility({}, '1.1.0').compatible).toBe(true)
  })
})
