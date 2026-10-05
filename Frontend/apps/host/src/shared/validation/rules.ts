import { validateFullPhone } from '@omniconnect/ui/validation'
/**
 * Form validation rules, in one place, mirroring the server's data annotations.
 *
 * The server is the authority — every one of these rules is also enforced in the API's DTOs, and a
 * direct API call is rejected with a 400 regardless of what the browser does. These exist purely so a
 * user learns about a mistake while their cursor is still in the field, instead of after a round trip.
 *
 * The limits below are not invented: each matches the corresponding `HasMaxLength` in the EF model, so
 * the form never accepts a value the column cannot store.
 */

/** Column limits, mirroring AuthDbContext / AppDbContext. */
export const LIMITS = {
  userName: 200,
  email: 320,
  phone: 32,
  roleName: 100,
  roleDescription: 500,
  appKey: 100,
  appDisplayName: 200,
  url: 2048,
  maintenanceMessage: 2000,
  employeeName: 200,
  department: 150,
} as const

/** Application keys become Module Federation container names and permission-key roots. See below. */
const APP_KEY_SHAPE = /^[a-z][a-z0-9-]{1,49}$/

export type FieldErrors<T extends string> = Partial<Record<T, string>>

export function required(value: string | null | undefined, label: string): string | undefined {
  return value == null || value.trim() === '' ? `${label} is required.` : undefined
}

export function maxLength(value: string | null | undefined, max: number, label: string): string | undefined {
  return value != null && value.length > max ? `${label} cannot exceed ${max} characters.` : undefined
}

/**
 * Email shape. Deliberately not a full RFC 5322 implementation — that pattern is famously
 * unmaintainable and rejects addresses that are actually valid. This requires a local part, an @, a
 * domain, and a dot-separated TLD of 2–24 letters, which is what the server's EmailAddress attribute
 * effectively accepts too.
 */
const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[A-Za-z]{2,24}$/

/**
 * Domains that are almost always a typo when something is appended to them.
 *
 * `ashok246@gmail.comsssssssss` is SYNTACTICALLY valid — `.comsssssssss` is a well-formed label, and
 * no regex can prove it is not a real TLD. But nobody has ever meant to type it. Catching the
 * near-miss against a handful of providers that account for most real addresses turns a silent
 * mistake into a specific, correctable message. This is the same approach mail-check libraries take,
 * kept to a short list so it stays honest rather than pretending to know every valid domain.
 */
const COMMON_DOMAINS = [
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'yahoo.co.in',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'rediffmail.com',
  'protonmail.com',
]

/**
 * Indian numbers are written as +91 98765 43210, 098765-43210, (022) 2222 3333 and more, so the SHAPE
 * is left loose — but the digit count is not. E.164 caps a full international number at 15 digits, and
 * nothing shorter than 7 is dialable, so anything outside that is a typo rather than a format we have
 * not thought of.
 *
 * The previous rule only checked the character set, which meant it rejected letters but happily
 * accepted "1" or a 40-digit string.
 */
// The generic 7–15 digit constants that used to live here are gone: the shared country-aware
// validator in @omniconnect/ui owns those limits now, per country rather than one range for the world.

export function email(value: string | null | undefined): string | undefined {
  if (value == null || value.trim() === '') return undefined
  const trimmed = value.trim()

  if (!EMAIL_SHAPE.test(trimmed)) return 'Enter a valid email address.'

  const domain = trimmed.slice(trimmed.lastIndexOf('@') + 1).toLowerCase()

  // Exact match against a known provider is fine; a near miss with junk appended is not.
  if (!COMMON_DOMAINS.includes(domain)) {
    const nearMiss = COMMON_DOMAINS.find((d) => domain.startsWith(d) && domain.length > d.length)
    if (nearMiss) {
      return `Did you mean @${nearMiss}? "${domain}" has extra characters.`
    }
  }

  return undefined
}

/**
 * Phone number. Required — an account with no reachable contact number is not much use to an
 * administrator trying to reach the person, and it is a common control requirement.
 */
export function phone(value: string | null | undefined): string | undefined {
  /*
   * Delegates to the shared country-aware validator rather than re-checking a generic 7-15 digit
   * range here. Two validators for one concept is how the platform ended up accepting a number in the
   * UI that the server then rejected - see packages/ui/src/validation/phone.ts.
   */
  return validateFullPhone(value)
}

/**
 * An absolute http(s) URL. Uses the URL constructor rather than a pattern — it is the same parser the
 * browser and the server use, so the form cannot disagree with them about what is valid.
 *
 * The protocol check matters: `new URL('javascript:alert(1)')` parses successfully, and a manifest URL
 * is fetched by the host at registration time, so a non-http scheme must never be accepted here.
 */
export function absoluteUrl(value: string | null | undefined, label: string): string | undefined {
  if (value == null || value.trim() === '') return undefined
  try {
    const parsed = new URL(value.trim())
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return `${label} must use http:// or https://`
    }
    return undefined
  } catch {
    return `${label} must be a full absolute URL, e.g. https://apps.example.com/mf-manifest.json`
  }
}

/**
 * A remote app's manifest URL — the browser twin of AuthService's ManifestUrlPolicy, so the form
 * answers the way the server will.
 *
 * The normal shape is a path on the platform's own origin, under the app's own folder and a version:
 * `/modules/lead/4.7.3/mf-manifest.json`. An absolute http(s) URL is let through here because only
 * the server knows whether this environment allows one (development does, production does not), and
 * it says so in its own words if not.
 */
export function manifestUrl(value: string | null | undefined, appKey: string): string | undefined {
  const url = (value ?? '').trim()
  if (url === '') return 'Manifest URL is required.'

  if (url.startsWith('/')) {
    const match = /^\/modules\/([a-z][a-z0-9-]{1,49})\/[A-Za-z0-9][A-Za-z0-9._+-]{0,63}\/mf-manifest\.json$/.exec(url)
    const folder = appKey.trim() || '<key>'
    if (!match) return `Must look like /modules/${folder}/<version>/mf-manifest.json.`
    if (appKey.trim() && match[1] !== appKey.trim()) {
      return `Must be under /modules/${appKey.trim()}/ — an app can only be served from its own folder.`
    }
    return undefined
  }

  return absoluteUrl(url, 'Manifest URL')
}

/**
 * Application key. This is not cosmetic strictness: the key becomes the Module Federation container
 * name AND the root of every permission feature key for the app — `remote.<key>` and
 * `remote.<key>.<module>:<capability>`. A key containing a dot would produce feature keys
 * indistinguishable from a sub-module of another app, silently corrupting the permission namespace, and
 * an uppercase letter would not match the lower-cased keys the enforcement attributes build.
 */
export function appKey(value: string | null | undefined): string | undefined {
  const missing = required(value, 'Application key')
  if (missing) return missing
  return APP_KEY_SHAPE.test(value!.trim())
    ? undefined
    : 'Application key must be 2-50 characters, start with a lowercase letter, and contain only lowercase letters, digits and hyphens.'
}

/** Non-negative, and within what a decimal(18,2) column can hold. */
export function salary(value: number | null | undefined): string | undefined {
  if (value == null || Number.isNaN(value)) return 'Salary is required.'
  if (value < 0) return 'Salary cannot be negative.'
  if (value > 9999999999999999.99) return 'Salary is larger than this system can record.'
  return undefined
}

/** Bounded so the sidebar cannot be handed a value that sorts nonsensically. Negative pins to the top. */
export function sidebarOrder(value: number | null | undefined): string | undefined {
  if (value == null || Number.isNaN(value)) return 'Display order is required.'
  if (!Number.isInteger(value)) return 'Display order must be a whole number.'
  if (value < -1000 || value > 100000) return 'Display order must be between -1000 and 100000.'
  return undefined
}

/** Case-insensitive duplicate check against names already in use, excluding the row being edited. */
export function notDuplicate(
  value: string | null | undefined,
  existing: { id: string; name: string }[],
  currentId: string | undefined,
  label: string,
): string | undefined {
  if (value == null || value.trim() === '') return undefined
  const needle = value.trim().toLowerCase()
  return existing.some((e) => e.id !== currentId && e.name.trim().toLowerCase() === needle)
    ? `A ${label} with this name already exists.`
    : undefined
}

/** Returns the first defined error, so a field reports one problem at a time rather than a stack. */
export function firstError(...checks: (string | undefined)[]): string | undefined {
  return checks.find((c) => c !== undefined)
}

/** True when no field has an error. */
export function isValid<T extends string>(errors: FieldErrors<T>): boolean {
  return Object.values(errors).every((v) => v === undefined)
}
