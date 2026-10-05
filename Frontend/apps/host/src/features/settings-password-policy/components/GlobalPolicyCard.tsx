import { useState } from 'react'
import { Button, Input, Switch } from '@omniconnect/ui'
import { Icon } from '../../../shared/components/Icon/Icon'
import { MAX_EXPIRY_DAYS, MAX_LEAD_DAY_ENTRIES, describeComplexity, type DraftErrors, type PolicyDraft } from '../utils/policyDraft'
import styles from '../pages/ManagePasswordPolicyPage.module.css'

interface GlobalPolicyCardProps {
  draft: PolicyDraft
  errors: DraftErrors
  canEdit: boolean
  onChange: (patch: Partial<PolicyDraft>) => void
}

/** A labelled switch row. The whole row is the click target, so the label is not a tiny tap zone. */
function ToggleRow({
  label, hint, checked, disabled, onChange,
}: { label: string; hint?: string; checked: boolean; disabled: boolean; onChange: (next: boolean) => void }) {
  return (
    <label className={styles.toggleRow}>
      <span className={styles.toggleText}>
        <span className={styles.toggleLabel}>{label}</span>
        {hint && <span className={styles.toggleHint}>{hint}</span>}
      </span>
      <Switch checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} aria-label={label} />
    </label>
  )
}

/**
 * The Global Policy tab: how long a password lives, what a new one must contain, and when users are
 * warned before theirs expires. Everything here applies to every role; the Role Policies tab only
 * overrides the LIFETIME.
 */
export function GlobalPolicyCard({ draft, errors, canEdit, onChange }: GlobalPolicyCardProps) {
  const [newDay, setNewDay] = useState('')
  const [dayError, setDayError] = useState<string | null>(null)

  const neverExpires = draft.expiryDays.trim() === '0'
  const min = Number(draft.minimumLength)
  const preview = describeComplexity({
    minimumLength: Number.isFinite(min) && draft.minimumLength.trim() !== '' ? min : 0,
    requireUppercase: draft.requireUppercase,
    requireLowercase: draft.requireLowercase,
    requireDigit: draft.requireDigit,
    requireNonAlphanumeric: draft.requireNonAlphanumeric,
  })

  function addLeadDay() {
    const text = newDay.trim()
    const days = Number(text)
    if (!/^\d+$/.test(text) || days < 1 || days > MAX_EXPIRY_DAYS) {
      setDayError('Enter a whole number of days, 1 or more.')
      return
    }
    if (draft.leadDays.includes(days)) {
      setDayError(`${days} is already in the list.`)
      return
    }
    if (draft.leadDays.length >= MAX_LEAD_DAY_ENTRIES) {
      setDayError(`At most ${MAX_LEAD_DAY_ENTRIES} reminder days.`)
      return
    }
    onChange({ leadDays: [...draft.leadDays, days].sort((a, b) => b - a) })
    setNewDay('')
    setDayError(null)
  }

  return (
    <div className={styles.stack}>
      {/* ── Lifetime ── */}
      <section className={styles.card} aria-labelledby="pp-lifetime-title">
        <div className={styles.cardHead}>
          <span className={`${styles.headIcon} ${styles.iconBlue}`}><Icon.Clock width={17} height={17} /></span>
          <div>
            <h3 id="pp-lifetime-title" className={styles.headTitle}>Password lifetime</h3>
            <p className={styles.headDesc}>How long a password stays valid before its owner must choose a new one.</p>
          </div>
        </div>
        <div className={styles.cardBody}>
          <Input
            className={styles.narrow}
            label="Passwords expire after (days)"
            type="number"
            inputMode="numeric"
            min={0}
            max={MAX_EXPIRY_DAYS}
            value={draft.expiryDays}
            disabled={!canEdit}
            onChange={(e) => onChange({ expiryDays: e.target.value })}
            helperText="Enter 0 for passwords that never expire. Roles can be given their own lifetime on the next tab."
            errorText={errors.expiryDays}
          />
        </div>
      </section>

      {/* ── Complexity ── */}
      <section className={styles.card} aria-labelledby="pp-complexity-title">
        <div className={styles.cardHead}>
          <span className={`${styles.headIcon} ${styles.iconPurple}`}><Icon.ShieldCheck width={17} height={17} /></span>
          <div>
            <h3 id="pp-complexity-title" className={styles.headTitle}>New password requirements</h3>
            <p className={styles.headDesc}>Checked whenever someone sets or changes a password. Applies to every role.</p>
          </div>
        </div>
        <div className={styles.cardBody}>
          <div className={styles.fieldRow}>
            <Input
              label="Minimum length"
              type="number"
              inputMode="numeric"
              min={6}
              max={64}
              value={draft.minimumLength}
              disabled={!canEdit}
              onChange={(e) => onChange({ minimumLength: e.target.value })}
              errorText={errors.minimumLength}
            />
            <Input
              label="Maximum length"
              type="number"
              inputMode="numeric"
              min={6}
              max={256}
              value={draft.maximumLength}
              disabled={!canEdit}
              onChange={(e) => onChange({ maximumLength: e.target.value })}
              helperText="Caps how much work hashing a very long password can cost."
              errorText={errors.maximumLength}
            />
          </div>

          <div className={styles.toggleList}>
            <ToggleRow label="Require an uppercase letter" checked={draft.requireUppercase} disabled={!canEdit} onChange={(v) => onChange({ requireUppercase: v })} />
            <ToggleRow label="Require a lowercase letter" checked={draft.requireLowercase} disabled={!canEdit} onChange={(v) => onChange({ requireLowercase: v })} />
            <ToggleRow label="Require a digit" checked={draft.requireDigit} disabled={!canEdit} onChange={(v) => onChange({ requireDigit: v })} />
            <ToggleRow label="Require a symbol" hint="Anything that is not a letter or a digit." checked={draft.requireNonAlphanumeric} disabled={!canEdit} onChange={(v) => onChange({ requireNonAlphanumeric: v })} />
            <ToggleRow label="Reject the current password" hint="Stops someone 'changing' their password to the one they already have." checked={draft.rejectSameAsCurrent} disabled={!canEdit} onChange={(v) => onChange({ rejectSameAsCurrent: v })} />
          </div>

          <p className={styles.preview} aria-live="polite">{preview}</p>
        </div>
      </section>

      {/* ── Reminders ── */}
      <section className={styles.card} aria-labelledby="pp-reminders-title">
        <div className={styles.cardHead}>
          <span className={`${styles.headIcon} ${styles.iconGreen}`}><Icon.Bell width={17} height={17} /></span>
          <div>
            <h3 id="pp-reminders-title" className={styles.headTitle}>Expiry reminders</h3>
            <p className={styles.headDesc}>Warn people before their password expires — choose where the warning appears and how far ahead.</p>
          </div>
        </div>
        <div className={styles.cardBody}>
          {neverExpires && (
            <div className={styles.notice} role="status">
              <Icon.Info width={14} height={14} />
              <span>Passwords never expire, so no reminders will be sent.</span>
            </div>
          )}

          <div className={styles.toggleList}>
            <ToggleRow label="Send an email reminder" hint="One email as each reminder day is reached." checked={draft.email} disabled={!canEdit} onChange={(v) => onChange({ email: v })} />
            <ToggleRow label="Show a banner in the app" hint="A dismissible notice at the top of the screen once the first reminder day is reached." checked={draft.inApp} disabled={!canEdit} onChange={(v) => onChange({ inApp: v })} />
          </div>

          <div>
            <span className={styles.toggleLabel}>Remind this many days before expiry</span>
            <div className={styles.chipRow} style={{ marginTop: 8 }}>
              {draft.leadDays.length === 0 && <span className={styles.emptyHint}>No reminders scheduled.</span>}
              {draft.leadDays.map((d) => (
                <span key={d} className={styles.chip}>
                  {d} {d === 1 ? 'day' : 'days'}
                  {canEdit && (
                    <button
                      type="button"
                      className={styles.chipRemove}
                      aria-label={`Remove reminder ${d} ${d === 1 ? 'day' : 'days'} before expiry`}
                      onClick={() => onChange({ leadDays: draft.leadDays.filter((x) => x !== d) })}
                    >
                      <Icon.X width={12} height={12} />
                    </button>
                  )}
                </span>
              ))}
            </div>

            {canEdit && (
              <div className={styles.addChip} style={{ marginTop: 10 }}>
                <Input
                  className={styles.addChipInput}
                  aria-label="Days before expiry"
                  placeholder="e.g. 10"
                  type="number"
                  inputMode="numeric"
                  min={1}
                  value={newDay}
                  onChange={(e) => { setNewDay(e.target.value); setDayError(null) }}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addLeadDay() } }}
                />
                <Button variant="secondary" size="sm" onClick={addLeadDay}>Add reminder</Button>
              </div>
            )}
            {(dayError || errors.leadDays) && (
              <p className={styles.fieldError} role="alert" style={{ marginTop: 6 }}>{dayError ?? errors.leadDays}</p>
            )}
          </div>
        </div>
      </section>
    </div>
  )
}
