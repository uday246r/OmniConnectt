/**
 * Country-aware phone validation — the single source of truth for the whole platform.
 *
 * Before this existed the same phone number could be judged three incompatible ways:
 *
 *  - AuthService accepted any 7–15 digits, country-agnostic.
 *  - LeadService hardcoded a Malaysia-only regex.
 *  - The host's user form carried real per-country digit ranges that the backend it posts to did not
 *    mirror at all.
 *
 * So a number the UI accepted could still be rejected server-side, and a malformed number for its
 * own country could sail through. Everything now derives from the one table below.
 */

export interface CountryPhoneConfig {
  /** ISO 3166-1 alpha-2. */
  code: string
  name: string
  dialCode: string
  flag: string
  /** Example national number, shown as the input's placeholder. */
  placeholder: string
  /** Digit count of the NATIONAL number, excluding the dial code. */
  minDigits: number
  maxDigits: number
}

export const COUNTRY_PHONE_LIST: CountryPhoneConfig[] = [
  { code: 'IN', name: 'India', dialCode: '+91', flag: '🇮🇳', placeholder: '98765 43210', minDigits: 10, maxDigits: 10 },
  { code: 'US', name: 'United States', dialCode: '+1', flag: '🇺🇸', placeholder: '(555) 000-0000', minDigits: 10, maxDigits: 10 },
  { code: 'GB', name: 'United Kingdom', dialCode: '+44', flag: '🇬🇧', placeholder: '7911 123456', minDigits: 10, maxDigits: 11 },
  { code: 'AE', name: 'United Arab Emirates', dialCode: '+971', flag: '🇦🇪', placeholder: '50 123 4567', minDigits: 9, maxDigits: 9 },
  { code: 'CA', name: 'Canada', dialCode: '+1', flag: '🇨🇦', placeholder: '(555) 000-0000', minDigits: 10, maxDigits: 10 },
  { code: 'AU', name: 'Australia', dialCode: '+61', flag: '🇦🇺', placeholder: '412 345 678', minDigits: 9, maxDigits: 9 },
  { code: 'SG', name: 'Singapore', dialCode: '+65', flag: '🇸🇬', placeholder: '8123 4567', minDigits: 8, maxDigits: 8 },
  { code: 'DE', name: 'Germany', dialCode: '+49', flag: '🇩🇪', placeholder: '151 23456789', minDigits: 10, maxDigits: 11 },
  { code: 'FR', name: 'France', dialCode: '+33', flag: '🇫🇷', placeholder: '6 12 34 56 78', minDigits: 9, maxDigits: 9 },
  { code: 'SA', name: 'Saudi Arabia', dialCode: '+966', flag: '🇸🇦', placeholder: '50 123 4567', minDigits: 9, maxDigits: 9 },
  { code: 'QA', name: 'Qatar', dialCode: '+974', flag: '🇶🇦', placeholder: '3312 3456', minDigits: 8, maxDigits: 8 },
  { code: 'PH', name: 'Philippines', dialCode: '+63', flag: '🇵🇭', placeholder: '917 123 4567', minDigits: 10, maxDigits: 10 },
  { code: 'NP', name: 'Nepal', dialCode: '+977', flag: '🇳🇵', placeholder: '9812345678', minDigits: 10, maxDigits: 10 },
  { code: 'BD', name: 'Bangladesh', dialCode: '+880', flag: '🇧🇩', placeholder: '1712 345678', minDigits: 10, maxDigits: 10 },
  { code: 'MY', name: 'Malaysia', dialCode: '+60', flag: '🇲🇾', placeholder: '12 345 6789', minDigits: 9, maxDigits: 10 },
  { code: 'JP', name: 'Japan', dialCode: '+81', flag: '🇯🇵', placeholder: '90 1234 5678', minDigits: 10, maxDigits: 10 },
  { code: 'NG', name: 'Nigeria', dialCode: '+234', flag: '🇳🇬', placeholder: '802 123 4567', minDigits: 10, maxDigits: 10 },
  { code: 'KE', name: 'Kenya', dialCode: '+254', flag: '🇰🇪', placeholder: '712 345678', minDigits: 9, maxDigits: 9 },
  { code: 'ZA', name: 'South Africa', dialCode: '+27', flag: '🇿🇦', placeholder: '82 123 4567', minDigits: 9, maxDigits: 9 },
  { code: 'BR', name: 'Brazil', dialCode: '+55', flag: '🇧🇷', placeholder: '11 91234-5678', minDigits: 10, maxDigits: 11 },
  { code: 'MX', name: 'Mexico', dialCode: '+52', flag: '🇲🇽', placeholder: '55 1234 5678', minDigits: 10, maxDigits: 10 },
  { code: 'CN', name: 'China', dialCode: '+86', flag: '🇨🇳', placeholder: '138 0013 8000', minDigits: 11, maxDigits: 11 },
  { code: 'HK', name: 'Hong Kong', dialCode: '+852', flag: '🇭🇰', placeholder: '9123 4567', minDigits: 8, maxDigits: 8 },
  { code: 'ID', name: 'Indonesia', dialCode: '+62', flag: '🇮🇩', placeholder: '812 3456 7890', minDigits: 9, maxDigits: 12 },
  { code: 'PK', name: 'Pakistan', dialCode: '+92', flag: '🇵🇰', placeholder: '300 1234567', minDigits: 10, maxDigits: 10 },
  { code: 'LK', name: 'Sri Lanka', dialCode: '+94', flag: '🇱🇰', placeholder: '71 234 5678', minDigits: 9, maxDigits: 9 },
  { code: 'CH', name: 'Switzerland', dialCode: '+41', flag: '🇨🇭', placeholder: '78 123 45 67', minDigits: 9, maxDigits: 9 },
  { code: 'NL', name: 'Netherlands', dialCode: '+31', flag: '🇳🇱', placeholder: '6 12345678', minDigits: 9, maxDigits: 9 },
  { code: 'SE', name: 'Sweden', dialCode: '+46', flag: '🇸🇪', placeholder: '70 123 45 67', minDigits: 9, maxDigits: 9 },
  { code: 'IE', name: 'Ireland', dialCode: '+353', flag: '🇮🇪', placeholder: '85 123 4567', minDigits: 9, maxDigits: 9 },
  { code: 'NZ', name: 'New Zealand', dialCode: '+64', flag: '🇳🇿', placeholder: '21 123 4567', minDigits: 8, maxDigits: 10 },
  { code: 'ES', name: 'Spain', dialCode: '+34', flag: '🇪🇸', placeholder: '612 345 678', minDigits: 9, maxDigits: 9 },
  { code: 'IT', name: 'Italy', dialCode: '+39', flag: '🇮🇹', placeholder: '312 345 6789', minDigits: 10, maxDigits: 10 },
  { code: 'PT', name: 'Portugal', dialCode: '+351', flag: '🇵🇹', placeholder: '912 345 678', minDigits: 9, maxDigits: 9 },
  { code: 'PL', name: 'Poland', dialCode: '+48', flag: '🇵🇱', placeholder: '512 345 678', minDigits: 9, maxDigits: 9 },
]

/** Formatting characters a person may reasonably type between digits. */
const ALLOWED_CHARS = /^[0-9\s()\-.]+$/

export const DEFAULT_COUNTRY_CODE = 'IN'

export function findCountry(code: string | null | undefined): CountryPhoneConfig {
  return COUNTRY_PHONE_LIST.find((c) => c.code === code) ?? COUNTRY_PHONE_LIST[0]
}

/**
 * Best-effort match of a stored E.164-ish string to a country, longest dial code first so +1 does not
 * shadow +12 style codes and +91 is not mistaken for +9.
 */
export function splitDialCode(stored: string | null | undefined): {
  countryCode: string
  nationalNumber: string
} {
  const trimmed = (stored ?? '').trim()
  if (!trimmed) return { countryCode: DEFAULT_COUNTRY_CODE, nationalNumber: '' }

  const byLongestDialCode = [...COUNTRY_PHONE_LIST].sort((a, b) => b.dialCode.length - a.dialCode.length)
  for (const country of byLongestDialCode) {
    if (trimmed.startsWith(country.dialCode)) {
      return {
        countryCode: country.code,
        nationalNumber: trimmed.slice(country.dialCode.length).trim(),
      }
    }
  }

  // No recognised dial code — treat the whole thing as a national number for the default country
  // rather than rejecting it, so existing records stay editable.
  return { countryCode: DEFAULT_COUNTRY_CODE, nationalNumber: trimmed }
}

/** Validates the NATIONAL part against that country's digit rules. Returns undefined when valid. */
export function validateCountryPhone(
  national: string | null | undefined,
  country: CountryPhoneConfig,
): string | undefined {
  if (national == null || national.trim() === '') return 'Phone number is required.'

  const trimmed = national.trim()
  if (!ALLOWED_CHARS.test(trimmed)) {
    return 'Phone number may contain only digits and formatting characters.'
  }

  const digits = trimmed.replace(/\D/g, '').length
  if (digits === 0) return 'Phone number is required.'

  if (country.minDigits === country.maxDigits) {
    return digits === country.minDigits
      ? undefined
      : `${country.name} phone number requires exactly ${country.minDigits} digits (${digits} entered).`
  }

  return digits >= country.minDigits && digits <= country.maxDigits
    ? undefined
    : `${country.name} phone number must be between ${country.minDigits} and ${country.maxDigits} digits (${digits} entered).`
}

/**
 * Validates a full number that already carries its dial code, e.g. "+60 12-345 6789".
 *
 * This is the form stored in the database and the form the servers see, so it is what any check
 * outside a country-picker UI should use.
 */
export function validateFullPhone(stored: string | null | undefined): string | undefined {
  if (stored == null || stored.trim() === '') return 'Phone number is required.'
  const { countryCode, nationalNumber } = splitDialCode(stored)
  return validateCountryPhone(nationalNumber, findCountry(countryCode))
}

/** Composes the stored form from a country and a national number. */
export function composePhone(country: CountryPhoneConfig, national: string): string {
  return `${country.dialCode} ${national.trim()}`.trim()
}
