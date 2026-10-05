import { Country } from 'country-state-city'
import { postcodeValidator, postcodeValidatorExistsForCountry } from 'postcode-validator'

/**
 * Resolves a country name or code to its ISO 3166-1 alpha-2 code (e.g. "India" -> "IN", "United States" -> "US", "India (+91)" -> "IN").
 */
export function getCountryIsoCode(countryNameOrCode?: string): string | undefined {
  if (!countryNameOrCode) return undefined
  const trimmed = countryNameOrCode.trim()
  if (!trimmed) return undefined

  if (trimmed.length === 2) {
    const byIso = Country.getCountryByCode(trimmed.toUpperCase())
    if (byIso) return byIso.isoCode
  }

  const all = Country.getAllCountries()
  const lower = trimmed.toLowerCase()

  // 1. Exact name or ISO match
  const exact = all.find(
    (c) =>
      c.name.toLowerCase() === lower ||
      c.isoCode.toLowerCase() === lower,
  )
  if (exact) return exact.isoCode

  // 2. Partial / substring match (e.g. "India (+91)" or "United States of America")
  const partial = all.find(
    (c) =>
      lower.includes(c.name.toLowerCase()) ||
      c.name.toLowerCase().includes(lower),
  )
  return partial?.isoCode
}

/**
 * Validates a postal / zip code against official postal patterns for the given country.
 * Uses postcode-validator library.
 */
export function validatePostalCode(
  postalCode: string,
  countryNameOrCode?: string,
): { valid: boolean; error?: string } {
  if (!postalCode || !postalCode.trim()) {
    return { valid: true }
  }

  const trimmed = postalCode.trim()
  const isoCode = getCountryIsoCode(countryNameOrCode)

  if (!isoCode) {
    // If no country is specified, validate general alphanumeric format (3 to 10 chars)
    const genericOk = /^[a-zA-Z0-9\s-]{3,10}$/.test(trimmed)
    return genericOk
      ? { valid: true }
      : { valid: false, error: 'Postal code must be 3-10 alphanumeric characters.' }
  }

  if (postcodeValidatorExistsForCountry(isoCode)) {
    let valid = postcodeValidator(trimmed, isoCode)
    // Try without spaces if formatted with spaces (e.g. "560 001" for India)
    if (!valid && trimmed.includes(' ')) {
      valid = postcodeValidator(trimmed.replace(/\s+/g, ''), isoCode)
    }
    return valid
      ? { valid: true }
      : { valid: false, error: `Invalid postal code for ${countryNameOrCode || isoCode}.` }
  }

  // Fallback for countries not directly in postcode-validator
  const genericOk = /^[a-zA-Z0-9\s-]{3,10}$/.test(trimmed)
  return genericOk
    ? { valid: true }
    : { valid: false, error: `Invalid postal code for ${countryNameOrCode || isoCode}.` }
}
