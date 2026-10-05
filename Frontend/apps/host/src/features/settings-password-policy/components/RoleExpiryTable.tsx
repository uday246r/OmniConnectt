import { Input } from '@omniconnect/ui'
import type { PasswordPolicyRole } from '../api/passwordPolicyApi'
import { MAX_EXPIRY_DAYS, type DraftErrors } from '../utils/policyDraft'
import styles from '../pages/ManagePasswordPolicyPage.module.css'

interface RoleExpiryTableProps {
  roles: PasswordPolicyRole[]
  /** roleId -> days as typed; blank or absent = inherit. */
  roleDays: Record<string, string>
  /** The global lifetime as currently typed, so a row can say what "inherit" means right now. */
  globalDays: string
  errors: DraftErrors
  canEdit: boolean
  onChange: (roleId: string, value: string) => void
}

/** Says, in words, what a blank row resolves to — so "inherit" is never a mystery. */
function inheritText(globalDays: string): string {
  const days = globalDays.trim()
  if (!/^\d+$/.test(days)) return 'Inherits the global lifetime'
  return days === '0' ? 'Inherits the global lifetime (never expires)' : `Inherits the global lifetime (${days} days)`
}

/**
 * One row per role. A role's own lifetime REPLACES the global one — it is not capped by it, so a role
 * can be given a shorter or a longer period. Leave a row blank to inherit.
 */
export function RoleExpiryTable({ roles, roleDays, globalDays, errors, canEdit, onChange }: RoleExpiryTableProps) {
  if (roles.length === 0) {
    return <div className={styles.emptyWrap}>There are no roles yet.</div>
  }

  return (
    <div>
      <div className={styles.tableHeader}>
        <span>Role</span>
        <span>Users</span>
        <span>Password lifetime (days)</span>
        <span>Applies</span>
      </div>

      {roles.map((role) => {
        const value = roleDays[role.id] ?? ''
        const hasOwn = value.trim() !== ''
        const error = errors.roles[role.id]
        return (
          <div key={role.id} className={styles.roleRow}>
            <span className={styles.roleName}>{role.name}</span>

            <span>
              <span className={styles.countPill} title={`${role.userCount} active user${role.userCount === 1 ? '' : 's'}`}>
                {role.userCount}
              </span>
            </span>

            <div className={styles.roleInputWrap}>
              <Input
                aria-label={`Password lifetime for ${role.name}`}
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_EXPIRY_DAYS}
                placeholder="Inherit"
                value={value}
                disabled={!canEdit}
                onChange={(e) => onChange(role.id, e.target.value)}
                errorText={error}
              />
            </div>

            <div className={styles.roleInputWrap}>
              <span className={`${styles.effective} ${hasOwn && !error ? styles.effectiveOwn : ''}`}>
                {hasOwn && !error ? `Expires after ${value.trim()} days` : inheritText(globalDays)}
              </span>
              {canEdit && hasOwn && (
                <button
                  type="button"
                  className={styles.clearBtn}
                  aria-label={`Use the global lifetime for ${role.name}`}
                  onClick={() => onChange(role.id, '')}
                >
                  Use global
                </button>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}
