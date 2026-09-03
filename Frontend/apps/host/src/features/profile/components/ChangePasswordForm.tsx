import { useState, type FormEvent } from 'react'
import { useAuthStore } from '../../auth/store/authStore'
import { authServiceClient } from '../../../shared/api/authServiceClient'
import { Icon } from '../../../shared/components/Icon/Icon'
import styles from './ChangePasswordForm.module.css'
import { Button, Input } from '@omniremit/ui'

export interface ChangePasswordFormProps {
  /** Called after the server confirms the change. The two callers do different things with it:
   * ProfilePage closes its drawer and toasts; the forced first-login gate refreshes the session,
   * which re-issues a token without the mustChangePassword claim and dissolves the gate. */
  onSuccess: () => void | Promise<void>
  onCancel?: () => void // omitted by the forced gate — there is nothing to cancel to
  submitLabel?: string
}

/**
 * The self-service change-password form, extracted from ProfilePage so the forced first-login gate
 * (RequirePasswordChange) can reuse the exact same validated flow instead of a second implementation.
 */
export function ChangePasswordForm({ onSuccess, onCancel, submitLabel = 'Update Password' }: ChangePasswordFormProps) {
  const accessToken = useAuthStore((s) => s.accessToken)
  const [currentPassword, setCurrentPassword] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [showCurrentPw, setShowCurrentPw] = useState(false)
  const [showNewPw, setShowNewPw] = useState(false)
  const [showConfirmPw, setShowConfirmPw] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleSubmit(e: FormEvent) {
    e.preventDefault()
    if (!currentPassword) {
      setError('Current password is required.')
      return
    }
    if (!newPassword) {
      setError('New password is required.')
      return
    }
    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match.')
      return
    }

    if (!accessToken) return

    setSaving(true)
    setError(null)

    try {
      await authServiceClient.changePassword(accessToken, { currentPassword, newPassword })
      setCurrentPassword('')
      setNewPassword('')
      setConfirmPassword('')
      await onSuccess()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update password. Please check your current password.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSubmit} className={styles.formStack}>
      {error && (
        <div className={styles.formError} role="alert">
          <Icon.AlertCircle width={16} height={16} />
          <span>{error}</span>
        </div>
      )}

      <Input
        label="Current Password"
        type={showCurrentPw ? 'text' : 'password'}
        placeholder="Enter your current password"
        value={currentPassword}
        onChange={(e) => setCurrentPassword(e.target.value)}
        required
        disabled={saving}
        leading={<Icon.Lock width={16} height={16} />}
        trailing={
          <button type="button" className={styles.eyeToggle} onClick={() => setShowCurrentPw(!showCurrentPw)} tabIndex={-1}>
            {showCurrentPw ? <Icon.EyeOff width={16} height={16} /> : <Icon.Eye width={16} height={16} />}
          </button>
        }
      />

      <Input
        label="New Password"
        type={showNewPw ? 'text' : 'password'}
        placeholder="Enter a new password"
        value={newPassword}
        onChange={(e) => setNewPassword(e.target.value)}
        required
        disabled={saving}
        leading={<Icon.Lock width={16} height={16} />}
        helperText="Your organisation's password policy is applied when you save."
        trailing={
          <button type="button" className={styles.eyeToggle} onClick={() => setShowNewPw(!showNewPw)} tabIndex={-1}>
            {showNewPw ? <Icon.EyeOff width={16} height={16} /> : <Icon.Eye width={16} height={16} />}
          </button>
        }
      />

      <Input
        label="Confirm New Password"
        type={showConfirmPw ? 'text' : 'password'}
        placeholder="Re-type new password"
        value={confirmPassword}
        onChange={(e) => setConfirmPassword(e.target.value)}
        required
        disabled={saving}
        leading={<Icon.Lock width={16} height={16} />}
        trailing={
          <button type="button" className={styles.eyeToggle} onClick={() => setShowConfirmPw(!showConfirmPw)} tabIndex={-1}>
            {showConfirmPw ? <Icon.EyeOff width={16} height={16} /> : <Icon.Eye width={16} height={16} />}
          </button>
        }
      />

      <div className={styles.footer}>
        {onCancel && (
          <Button type="button" variant="secondary" disabled={saving} onClick={onCancel}>
            Cancel
          </Button>
        )}
        <Button type="submit" variant="primary" loading={saving} leadingIcon={<Icon.CheckCircle width={16} height={16} />}>
          {submitLabel}
        </Button>
      </div>
    </form>
  )
}
