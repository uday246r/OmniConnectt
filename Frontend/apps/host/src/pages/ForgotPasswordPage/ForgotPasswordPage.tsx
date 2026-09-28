import { useId, useState, type FormEvent } from 'react'
import { Link } from 'react-router-dom'
import { Icon } from '../../shared/components/Icon/Icon'
import { BrandMark } from '../../shared/components/BrandMark/BrandMark'
import { LoginHero } from '../LoginPage/LoginHero'
import { authServiceClient } from '../../shared/api/authServiceClient'
import { ApiError } from '../../shared/api/httpClient'
import { APP_NAME } from '../../shared/config/branding'
import styles from './ForgotPasswordPage.module.css'

/**
 * Where "Forgot password?" on the login page leads. Public by necessity — the whole point is that
 * the visitor has no session.
 *
 * The confirmation screen is shown for EVERY submitted address, whether or not it matches a real
 * account: the server's response is deliberately identical either way (see AuthController.ForgotPassword),
 * and this page must not undo that by branching client-side on anything the response doesn't actually
 * say. Only a genuine request failure (network error, rate limit) surfaces as an error here.
 */
export function ForgotPasswordPage() {
  const [email, setEmail] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sent, setSent] = useState(false)

  const emailId = useId()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!email || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      await authServiceClient.forgotPassword(email.trim())
      setSent(true)
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.')
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

            {sent ? (
              <div className={styles.centered}>
                <div className={styles.successIcon}><Icon.CheckCircle width={26} height={26} /></div>
                <h2 className={styles.cardTitle}>Check your email</h2>
                <p className={styles.muted}>
                  If an account exists for <strong>{email.trim()}</strong>, we&apos;ve sent a link to
                  reset your password. For your security, that link expires in just 5 minutes, so
                  please use it soon.
                </p>
                <Link to="/login" className={styles.secondaryLink}>Back to sign in</Link>
              </div>
            ) : (
              <form onSubmit={handleSubmit} noValidate>
                <div className={styles.cardHeader}>
                  <h2 className={styles.cardTitle}>Forgot your password?</h2>
                  <p className={styles.cardSubtitle}>
                    Enter the email address on your account and we&apos;ll send you a link to reset
                    your password.
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
                    <label className={styles.fieldLabel} htmlFor={emailId}>Email address</label>
                    <div className={styles.inputWrapper}>
                      <Icon.Mail width={17} height={17} className={styles.inputLeadingIcon} />
                      <input
                        id={emailId}
                        type="email"
                        autoComplete="username"
                        placeholder="Enter your work email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        required
                        disabled={submitting}
                        className={styles.textInput}
                      />
                    </div>
                  </div>
                </div>

                <button
                  type="submit"
                  disabled={submitting || !email}
                  className={styles.signInButton}
                >
                  {submitting ? (
                    <>
                      <Icon.Loader width={18} height={18} className={styles.spinner} />
                      <span>Sending…</span>
                    </>
                  ) : (
                    <>
                      <span>Send reset link</span>
                      <Icon.ArrowRight width={17} height={17} />
                    </>
                  )}
                </button>

                <div className={styles.cardFooterLinkRow}>
                  <Link to="/login" className={styles.footerTextLink}>Back to sign in</Link>
                </div>
              </form>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
