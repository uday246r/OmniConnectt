import { useEffect, useId, useState, type FormEvent } from 'react'
import { useSearchParams, Link } from 'react-router-dom'
import { Icon } from '../../shared/components/Icon/Icon'
import { BrandMark } from '../../shared/components/BrandMark/BrandMark'
import { LoginHero } from '../LoginPage/LoginHero'
import { authServiceClient } from '../../shared/api/authServiceClient'
import { ApiError } from '../../shared/api/httpClient'
import { APP_NAME } from '../../shared/config/branding'
import styles from './ResetPasswordPage.module.css'

/**
 * Where a "Forgot password?" reset link lands. Public by necessity — same reasoning as
 * SetPasswordPage, which this deliberately mirrors: the token is validated before the form is shown,
 * so an expired or already-used link says so immediately. The server never distinguishes "unknown",
 * "expired" and "used" from one another, and neither does this page.
 *
 * The one meaningful difference from SetPasswordPage: this link expires in minutes, not hours, so the
 * copy below says so up front rather than letting the user discover it only after typing a password.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams()
  const token = params.get('token') ?? ''

  const [checking, setChecking] = useState(true)
  const [valid, setValid] = useState(false)
  const [email, setEmail] = useState<string | null>(null)

  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const passwordId = useId()
  const confirmId = useId()

  useEffect(() => {
    let cancelled = false
    if (!token) {
      setChecking(false)
      setValid(false)
      return
    }
    void (async () => {
      try {
        const result = await authServiceClient.validateResetToken(token)
        if (cancelled) return
        setValid(result.valid)
        setEmail(result.email)
      } catch {
        if (!cancelled) setValid(false)
      } finally {
        if (!cancelled) setChecking(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [token])

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (submitting) return
    // Checked here rather than server-side: the confirmation field exists purely to catch typing
    // mistakes, and the server has no business knowing the password was entered twice.
    if (password !== confirm) {
      setError('The two passwords do not match.')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      await authServiceClient.resetPassword(token, password)
      setDone(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not reset your password. Please try again.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.brandPanel}>
        <LoginHero />
      </div>

      <div className={styles.formPanel}>
        <div className={styles.formCardContainer}>
          <div className={styles.formCard}>
            <div className={styles.brandBadge}>
              <BrandMark size={40} />
              <span className={styles.brandBadgeText}>{APP_NAME}</span>
            </div>

            {checking && (
              <div className={styles.centered}>
                <Icon.Loader width={22} height={22} className={styles.spinner} />
                <p className={styles.muted}>Checking your reset link…</p>
              </div>
            )}

            {!checking && !valid && (
              <div className={styles.centered}>
                <h2 className={styles.cardTitle}>This link is no longer valid</h2>
                <p className={styles.muted}>
                  Password reset links can be used once and expire just 5 minutes after being
                  requested. Request a new one to continue.
                </p>
                <Link to="/forgot-password" className={styles.primaryLink}>Request a new link</Link>
                <Link to="/login" className={styles.secondaryLink}>Back to sign in</Link>
              </div>
            )}

            {!checking && valid && done && (
              <div className={styles.centered}>
                <div className={styles.successIcon}><Icon.CheckCircle width={26} height={26} /></div>
                <h2 className={styles.cardTitle}>Your password has been reset</h2>
                <p className={styles.muted}>
                  You can now sign in with your new password. For your security, you have been signed
                  out of every other session.
                </p>
                <Link to="/login" className={styles.primaryLink}>Continue to sign in</Link>
              </div>
            )}

            {!checking && valid && !done && (
              <form onSubmit={handleSubmit} noValidate>
                <div className={styles.cardHeader}>
                  <h2 className={styles.cardTitle}>Choose a new password</h2>
                  <p className={styles.cardSubtitle}>
                    {email
                      ? <>Resetting the password for <strong>{email}</strong>.</>
                      : 'Choose a new password for your account.'}
                  </p>
                </div>

                {error && (
                  <div className={styles.errorAlert} role="alert">
                    <span className={styles.errorIcon}>⚠</span>
                    <span>{error}</span>
                  </div>
                )}

                <div className={styles.formFields}>
                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel} htmlFor={passwordId}>New password</label>
                    <div className={styles.inputWrapper}>
                      <Icon.Lock width={17} height={17} className={styles.inputLeadingIcon} />
                      <input
                        id={passwordId}
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        placeholder="Enter a new password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        disabled={submitting}
                        className={styles.textInput}
                      />
                      <button
                        type="button"
                        className={styles.eyeToggleBtn}
                        onClick={() => setShowPassword((v) => !v)}
                        aria-label={showPassword ? 'Hide password' : 'Show password'}
                        tabIndex={-1}
                      >
                        {showPassword ? <Icon.EyeOff width={17} height={17} /> : <Icon.Eye width={17} height={17} />}
                      </button>
                    </div>
                  </div>

                  <div className={styles.fieldGroup}>
                    <label className={styles.fieldLabel} htmlFor={confirmId}>Confirm password</label>
                    <div className={styles.inputWrapper}>
                      <Icon.Lock width={17} height={17} className={styles.inputLeadingIcon} />
                      <input
                        id={confirmId}
                        type={showPassword ? 'text' : 'password'}
                        autoComplete="new-password"
                        placeholder="Re-enter the password"
                        value={confirm}
                        onChange={(e) => setConfirm(e.target.value)}
                        required
                        disabled={submitting}
                        className={styles.textInput}
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting || !password || !confirm}
                  className={styles.signInButton}
                >
                  {submitting ? (
                    <>
                      <Icon.Loader width={18} height={18} className={styles.spinner} />
                      <span>Saving…</span>
                    </>
                  ) : (
                    <>
                      <span>Reset password</span>
                      <Icon.ArrowRight width={17} height={17} />
                    </>
                  )}
                </button>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
