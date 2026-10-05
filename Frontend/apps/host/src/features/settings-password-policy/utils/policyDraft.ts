import type { PasswordComplexity, PasswordPolicy } from '../api/passwordPolicyApi'

/**
 * The editable form of a policy. Numbers are held as STRINGS while the admin types: an empty box, or a
 * half-typed "1" on the way to "14", must not be coerced to 0 (which would mean "never expires") or NaN
 * mid-keystroke. They become numbers only in {@link buildPolicy}, which is also where every rule the
 * server enforces is checked, so the browser refuses what the server would refuse — with the same words.
 */
export interface PolicyDraft {
  expiryDays: string
  minimumLength: string
  maximumLength: string
  requireUppercase: boolean
  requireLowercase: boolean
  requireDigit: boolean
  requireNonAlphanumeric: boolean
  rejectSameAsCurrent: boolean
  email: boolean
  inApp: boolean
  leadDays: number[]
  /** roleId -> days as typed. Absent or blank means "inherit the global value". */
  roleDays: Record<string, string>
}

/** Mirror of PasswordPolicyAppService's limits — keep in step with the server. */
export const MAX_EXPIRY_DAYS = 3650
export const MAX_LEAD_DAY_ENTRIES = 5

export function toDraft(policy: PasswordPolicy): PolicyDraft {
  const c = policy.complexity
  return {
    expiryDays: String(policy.expiryDays),
    minimumLength: String(c.minimumLength),
    maximumLength: String(c.maximumLength),
    requireUppercase: c.requireUppercase,
    requireLowercase: c.requireLowercase,
    requireDigit: c.requireDigit,
    requireNonAlphanumeric: c.requireNonAlphanumeric,
    rejectSameAsCurrent: c.rejectSameAsCurrent,
    email: policy.notifications.email,
    inApp: policy.notifications.inApp,
    leadDays: [...policy.notifications.leadDays].sort((a, b) => b - a),
    roleDays: Object.fromEntries(policy.roleExpiries.map((r) => [r.roleId, String(r.expiryDays)])),
  }
}

export type DraftErrors = Partial<Record<'expiryDays' | 'minimumLength' | 'maximumLength' | 'leadDays', string>> & {
  /** roleId -> message */
  roles: Record<string, string>
}

const isWholeNumber = (text: string) => /^\d+$/.test(text.trim())

export interface BuildResult {
  policy: PasswordPolicy | null
  errors: DraftErrors
}

/** Turns the draft into a policy, or explains every reason it can't. `policy` is null when there are errors. */
export function buildPolicy(draft: PolicyDraft, knownRoleIds: readonly string[]): BuildResult {
  const errors: DraftErrors = { roles: {} }

  const expiryText = draft.expiryDays.trim()
  const expiry = Number(expiryText)
  if (!isWholeNumber(expiryText) || expiry > MAX_EXPIRY_DAYS) {
    errors.expiryDays = `Enter a whole number from 0 (never) to ${MAX_EXPIRY_DAYS}.`
  }

  const min = Number(draft.minimumLength.trim())
  const max = Number(draft.maximumLength.trim())
  if (!isWholeNumber(draft.minimumLength) || min < 6 || min > 64) {
    errors.minimumLength = 'Minimum length must be between 6 and 64.'
  }
  if (!isWholeNumber(draft.maximumLength) || max > 256 || (!errors.minimumLength && max < min)) {
    errors.maximumLength = 'Maximum length must be at least the minimum, and at most 256.'
  }

  if (draft.leadDays.length > MAX_LEAD_DAY_ENTRIES) {
    errors.leadDays = `Choose at most ${MAX_LEAD_DAY_ENTRIES} reminder days.`
  } else if (!errors.expiryDays && expiry > 0 && draft.leadDays.some((d) => d >= expiry)) {
    // A reminder due on or after the day the password already expires could never be sent.
    errors.leadDays = 'Every reminder must be sooner than the expiry period.'
  }

  const roleExpiries: PasswordPolicy['roleExpiries'] = []
  for (const roleId of knownRoleIds) {
    const text = (draft.roleDays[roleId] ?? '').trim()
    if (text === '') continue // blank = inherit; no row is sent
    const days = Number(text)
    // 0 is not offered per role: a stray 0 in one row would silently switch expiry off for the whole role.
    if (!isWholeNumber(text) || days < 1 || days > MAX_EXPIRY_DAYS) {
      errors.roles[roleId] = `Enter 1 to ${MAX_EXPIRY_DAYS} days, or leave blank to use the global value.`
    } else {
      roleExpiries.push({ roleId, expiryDays: days })
    }
  }

  const hasErrors =
    Boolean(errors.expiryDays || errors.minimumLength || errors.maximumLength || errors.leadDays) ||
    Object.keys(errors.roles).length > 0
  if (hasErrors) return { policy: null, errors }

  return {
    errors,
    policy: {
      expiryDays: expiry,
      roleExpiries,
      complexity: {
        minimumLength: min,
        maximumLength: max,
        requireUppercase: draft.requireUppercase,
        requireLowercase: draft.requireLowercase,
        requireDigit: draft.requireDigit,
        requireNonAlphanumeric: draft.requireNonAlphanumeric,
        rejectSameAsCurrent: draft.rejectSameAsCurrent,
      },
      notifications: {
        email: draft.email,
        inApp: draft.inApp,
        leadDays: [...new Set(draft.leadDays)].sort((a, b) => b - a),
      },
    },
  }
}

/** True when the draft differs from the saved policy in any way the admin could see. */
export function isDirty(draft: PolicyDraft, saved: PasswordPolicy): boolean {
  return JSON.stringify(normalise(draft)) !== JSON.stringify(normalise(toDraft(saved)))
}

function normalise(d: PolicyDraft) {
  return {
    ...d,
    expiryDays: d.expiryDays.trim(),
    minimumLength: d.minimumLength.trim(),
    maximumLength: d.maximumLength.trim(),
    leadDays: [...d.leadDays].sort((a, b) => b - a),
    // Blank rows carry no information — an untouched role and one cleared back to blank are the same.
    roleDays: Object.fromEntries(
      Object.entries(d.roleDays)
        .map(([id, v]) => [id, v.trim()] as const)
        .filter(([, v]) => v !== '')
        .sort(([a], [b]) => a.localeCompare(b)),
    ),
  }
}

/** Plain-English summary of the rules, for the live preview beside the toggles. */
export function describeComplexity(c: Pick<PasswordComplexity, 'minimumLength' | 'requireUppercase' | 'requireLowercase' | 'requireDigit' | 'requireNonAlphanumeric'>): string {
  const parts = [`at least ${c.minimumLength} characters`]
  if (c.requireUppercase) parts.push('an uppercase letter')
  if (c.requireLowercase) parts.push('a lowercase letter')
  if (c.requireDigit) parts.push('a digit')
  if (c.requireNonAlphanumeric) parts.push('a symbol')
  return parts.length === 1
    ? `Password must be ${parts[0]}.`
    : `Password must contain ${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}.`
}
