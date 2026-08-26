/**
 * Client-side mirror of AuthService's `PasswordPolicyOptions.Validate`.
 *
 * Deliberately a mirror and not a second opinion: the policy VALUES are fetched from
 * `GET /api/auth/password-policy` at runtime rather than hardcoded, so an administrator changing the
 * policy in configuration changes what the UI enforces without a rebuild. The checks below are only
 * the shape of the rules, which is why they can safely live in the client.
 *
 * The server remains authoritative — this exists so the user is told what is wrong while they are
 * typing, instead of after a round trip. Before it, the change-password form checked only that the
 * two fields matched, while its own helper text claimed a policy was applied.
 */

export interface PasswordPolicy {
  minimumLength: number
  maximumLength: number
  requireUppercase: boolean
  requireLowercase: boolean
  requireDigit: boolean
  requireNonAlphanumeric: boolean
  /** Server-rendered sentence describing the whole policy, for display. */
  description: string
}

export interface PasswordRuleState {
  label: string
  satisfied: boolean
}

/**
 * Every rule the policy imposes, each flagged satisfied or not, so the form can show a live checklist
 * rather than one error at a time. Order is stable so the list does not reshuffle as the user types.
 */
export function describePasswordRules(password: string, policy: PasswordPolicy): PasswordRuleState[] {
  const value = password ?? ''
  const rules: PasswordRuleState[] = [
    {
      label: `Between ${policy.minimumLength} and ${policy.maximumLength} characters`,
      satisfied: value.length >= policy.minimumLength && value.length <= policy.maximumLength,
    },
  ]

  if (policy.requireUppercase) {
    rules.push({ label: 'At least one uppercase letter', satisfied: /[A-Z]/.test(value) })
  }
  if (policy.requireLowercase) {
    rules.push({ label: 'At least one lowercase letter', satisfied: /[a-z]/.test(value) })
  }
  if (policy.requireDigit) {
    rules.push({ label: 'At least one number', satisfied: /[0-9]/.test(value) })
  }
  if (policy.requireNonAlphanumeric) {
    rules.push({
      label: 'At least one symbol',
      // "Not a letter or a digit" — matches the server's `password.All(char.IsLetterOrDigit)` check
      // rather than enumerating an allowed symbol set, which would reject valid passwords.
      satisfied: /[^A-Za-z0-9]/.test(value),
    })
  }

  return rules
}

/** The first unmet rule, or undefined when the password satisfies the policy. */
export function validatePassword(password: string | null | undefined, policy: PasswordPolicy): string | undefined {
  if (password == null || password === '') return 'Password is required.'
  const unmet = describePasswordRules(password, policy).find((r) => !r.satisfied)
  return unmet ? unmet.label : undefined
}
