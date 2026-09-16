import { describe, expect, it } from 'vitest'
import { describeStatusCode, formatEventCode, formatServiceName } from './systemLogFormatting'

/**
 * Event codes come from every service in whatever casing its author chose. The list and the drawer show
 * the formatted name instead of the code, so a code this cannot read would show up as gibberish on the
 * screen people use to triage incidents.
 */
describe('formatEventCode', () => {
  it.each([
    ['unhandled_exception', 'Unhandled exception'],
    ['auth.token-expired', 'Auth token expired'],
    ['HealthCheckFailed', 'Health check failed'],
    ['HTTP_500', 'HTTP 500'],
    ['CRMTimeout', 'CRM timeout'],
    ['startup', 'Startup'],
  ])('%s → %s', (code, expected) => {
    expect(formatEventCode(code)).toBe(expected)
  })

  it('names a missing code rather than rendering nothing', () => {
    expect(formatEventCode('')).toBe('Unknown event')
  })
})

describe('describeStatusCode', () => {
  it('describes known and unknown statuses and leaves a missing one out', () => {
    expect(describeStatusCode(404)).toBe('Not found (404)')
    expect(describeStatusCode(599)).toBe('Server error (599)')
    expect(describeStatusCode(null)).toBeNull()
  })
})

describe('formatServiceName', () => {
  it('splits a service type name into words', () => {
    expect(formatServiceName('Customer360Service')).toBe('Customer 360 Service')
    expect(formatServiceName('AuthService')).toBe('Auth Service')
  })
})
