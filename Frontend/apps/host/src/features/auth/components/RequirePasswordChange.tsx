import { useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { Button } from '@omniconnect/ui'
import { useAuthStore } from '../store/authStore'
import { ChangePasswordForm } from '../../profile/components/ChangePasswordForm'
import { authServiceClient } from '../../../shared/api/authServiceClient'
import styles from './RequirePasswordChange.module.css'

type ResetLinkState = 'idle' | 'sending' | 'sent' | 'error'

/**
 * Hard stop between authentication and the application. While the current session says the account
 * must change its password, this renders ONLY the change-password form — no sidebar, no topbar, no
 * routed page, no remote micro-frontend, because it sits above AppShell in the tree and AppShell is
 * what mounts all of those.
 *
 * Two situations share the flag and get different words: an administrator-issued temporary password,
 * and a password that has outlived the policy. The expired case also offers to email a reset link — for
 * someone who no longer remembers the old password, which the in-app form needs.
 *
 * Mirrors the server: AuthService refuses every endpoint except change-password/refresh/logout/me
 * for the same user (MustChangePasswordFilter). This is the visible half of that rule, not the
 * enforcement itself — a user who bypasses this component still gets 403s from the API.
 */
export function RequirePasswordChange({ children }: { children: ReactNode }) {
  const user = useAuthStore((s) => s.user)
  const refreshSession = useAuthStore((s) => s.refreshSession)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()
  const [resetLink, setResetLink] = useState<ResetLinkState>('idle')

  const mustChangePassword = user?.mustChangePassword ?? false
  if (!mustChangePassword) return <>{children}</>

  const expiry = user?.passwordExpiry
  const expired = expiry?.isExpired ?? false
  const expiredOn = expiry?.expiresAt ? new Date(expiry.expiresAt).toLocaleDateString(undefined, { dateStyle: 'long' }) : null
  // A Google account has no OmniConnect password, so a reset email would go nowhere useful.
  const canEmailLink = expired && user?.authProvider === 'Local' && Boolean(user?.email)

  async function sendResetLink() {
    if (!user?.email || resetLink === 'sending') return
    setResetLink('sending')
    try {
      await authServiceClient.forgotPassword(user.email)
      setResetLink('sent')
    } catch {
      // Only a genuine request failure (network, rate limit) — the endpoint itself answers identically
      // whether or not the address matched, so there is nothing else to branch on.
      setResetLink('error')
    }
  }

  return (
    <div className={styles.gate}>
      <div className={styles.card}>
        {expired ? (
          <>
            <h1 className={styles.title}>Your password has expired</h1>
            <p className={styles.subtitle}>
              {expiredOn ? `Your password expired on ${expiredOn}. ` : ''}
              For your security it must be replaced before you can use OmniConnect. Choose a new one below
              {canEmailLink ? ', or have a secure link emailed to you' : ''}.
            </p>
          </>
        ) : (
          <>
            <h1 className={styles.title}>Choose your password</h1>
            <p className={styles.subtitle}>
              Your account is still using the temporary password you were given. Set your own password to
              continue — you won't be able to use OmniConnect until you do.
            </p>
          </>
        )}

        <ChangePasswordForm
          submitLabel={expired ? 'Set a new password' : 'Set my password'}
          // refreshSession() re-issues the access token from the LIVE user row, which now has
          // MustChangePassword = false, so this component re-renders past the gate. No manual flag
          // flipping here — the server stays the source of truth.
          onSuccess={() => refreshSession()}
        />

        {canEmailLink && (
          <div className={styles.emailBlock}>
            {resetLink === 'sent' ? (
              <p className={styles.emailNote} role="status">
                If your account can receive email, a reset link is on its way to {user?.email}. Opening it
                lets you choose a new password; it signs you out everywhere, so sign in again afterwards.
              </p>
            ) : (
              <>
                <Button
                  variant="secondary"
                  loading={resetLink === 'sending'}
                  onClick={() => void sendResetLink()}
                >
                  Email me a reset link
                </Button>
                {resetLink === 'error' && (
                  <p className={styles.emailError} role="alert">
                    We couldn't send that just now. Please wait a moment and try again.
                  </p>
                )}
              </>
            )}
          </div>
        )}

        <button
          type="button"
          className={styles.signOutLink}
          onClick={() => { void logout().then(() => navigate('/login', { replace: true })) }}
        >
          Sign out instead
        </button>
      </div>
    </div>
  )
}
