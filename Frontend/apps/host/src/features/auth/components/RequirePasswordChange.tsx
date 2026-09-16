import type { ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuthStore } from '../store/authStore'
import { ChangePasswordForm } from '../../profile/components/ChangePasswordForm'
import styles from './RequirePasswordChange.module.css'

/**
 * Hard stop between authentication and the application. While the current session says the account
 * is still on an administrator-issued temporary password, this renders ONLY the change-password
 * form — no sidebar, no topbar, no routed page, no remote micro-frontend, because it sits above
 * AppShell in the tree and AppShell is what mounts all of those.
 *
 * Mirrors the server: AuthService refuses every endpoint except change-password/refresh/logout/me
 * for the same user (MustChangePasswordFilter). This is the visible half of that rule, not the
 * enforcement itself — a user who bypasses this component still gets 403s from the API.
 */
export function RequirePasswordChange({ children }: { children: ReactNode }) {
  const mustChangePassword = useAuthStore((s) => s.user?.mustChangePassword ?? false)
  const refreshSession = useAuthStore((s) => s.refreshSession)
  const logout = useAuthStore((s) => s.logout)
  const navigate = useNavigate()

  if (!mustChangePassword) return <>{children}</>

  return (
    <div className={styles.gate}>
      <div className={styles.card}>
        <h1 className={styles.title}>Choose your password</h1>
        <p className={styles.subtitle}>
          Your account is still using the temporary password you were given. Set your own password to
          continue — you won't be able to use OmniConnect until you do.
        </p>
        <ChangePasswordForm
          submitLabel="Set my password"
          // refreshSession() re-issues the access token from the LIVE user row, which now has
          // MustChangePassword = false, so this component re-renders past the gate. No manual flag
          // flipping here — the server stays the source of truth.
          onSuccess={() => refreshSession()}
        />
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
