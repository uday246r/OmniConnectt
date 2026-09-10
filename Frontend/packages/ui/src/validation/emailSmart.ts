/**
 * The "Email address" preset's check — same shape + near-miss-domain rule as
 * Backend/AuthService/Infrastructure/Validation/EmailSmartValidator.cs, so a value the schema builder's
 * preset accepts or rejects here is judged identically server-side. Kept as its own small module (not
 * imported from apps/host/src/shared/validation/rules.ts) because packages/ui must not depend on the
 * host app — the two copies are meant to be kept in sync deliberately, not by construction.
 */

const EMAIL_SHAPE = /^[^\s@]+@[^\s@.]+(\.[^\s@.]+)*\.[A-Za-z]{2,24}$/

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

export function isEmailSmart(value: string): boolean {
  const trimmed = value.trim()
  if (!EMAIL_SHAPE.test(trimmed)) return false

  const domain = trimmed.slice(trimmed.lastIndexOf('@') + 1).toLowerCase()
  if (COMMON_DOMAINS.includes(domain)) return true

  const nearMiss = COMMON_DOMAINS.some((d) => domain.startsWith(d) && domain.length > d.length)
  return !nearMiss
}
