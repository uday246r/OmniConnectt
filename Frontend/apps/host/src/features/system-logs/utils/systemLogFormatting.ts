import type { BadgeTone } from '@omniremit/ui'

/*
 * System logs are written by services for engineers: event codes like "unhandled_exception" or
 * "HealthCheckFailed", bare HTTP status numbers, correlation GUIDs. The screen is also read by
 * operators who need to know what happened, not how it was keyed. These helpers turn the machine
 * values into words; the raw values stay available under "Technical details".
 */

/** Short upper-case words that stay upper-case when a code is turned into a sentence. */
const ACRONYMS = new Set(['api', 'http', 'https', 'id', 'jwt', 'sql', 'db', 'crm', 'csv', 'url', 'ip', 'ui', 'mf', 'smtp', 'cors', 'otp', 'sso'])

/** "unhandled_exception" / "auth.token-expired" / "HealthCheckFailed" / "HTTP_500" → "Unhandled exception", "Auth token expired", "Health check failed", "HTTP 500". */
export function formatEventCode(code: string | null | undefined): string {
  if (!code) return 'Unknown event'
  const words = code
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(/[\s._\-:/]+/)
    .filter(Boolean)
    .map((w) => (ACRONYMS.has(w.toLowerCase()) ? w.toUpperCase() : w.toLowerCase()))
  if (words.length === 0) return code
  const [first, ...rest] = words
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(' ')
}

/** An HTTP status described for a person: "Server error (500)", "Not found (404)". */
export function describeStatusCode(status: number | null | undefined): string | null {
  if (status === null || status === undefined) return null
  const known: Record<number, string> = {
    400: 'Bad request',
    401: 'Not signed in',
    403: 'Not allowed',
    404: 'Not found',
    408: 'Timed out',
    409: 'Conflict',
    412: 'Changed by someone else',
    422: 'Invalid data',
    429: 'Too many requests',
    500: 'Server error',
    502: 'Upstream service error',
    503: 'Service unavailable',
    504: 'Upstream timed out',
  }
  const label = known[status] ?? (status >= 500 ? 'Server error' : status >= 400 ? 'Request refused' : status >= 300 ? 'Redirected' : 'Succeeded')
  return `${label} (${status})`
}

export function statusCodeTone(status: number): BadgeTone {
  if (status >= 500) return 'danger'
  if (status >= 400) return 'warning'
  return 'success'
}

export function severityTone(severity: string): BadgeTone {
  const s = severity.toLowerCase()
  if (s === 'critical' || s === 'error') return 'danger'
  if (s === 'warning') return 'warning'
  if (s === 'info') return 'info'
  return 'neutral'
}

export function environmentTone(environment: string | null | undefined): BadgeTone {
  if (!environment) return 'neutral'
  const e = environment.toLowerCase()
  if (e.includes('prod')) return 'danger'
  if (e.includes('stag')) return 'warning'
  if (e.includes('dev')) return 'info'
  return 'neutral'
}

/** "AuthService" → "Auth Service", "Customer360Service" → "Customer 360 Service". */
export function formatServiceName(service: string | null | undefined): string {
  if (!service) return ''
  return service
    .replace(/([a-z])([A-Z0-9])/g, '$1 $2')
    .replace(/([0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .trim()
}
