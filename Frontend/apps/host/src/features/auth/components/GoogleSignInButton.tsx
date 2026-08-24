import { useGoogleSignIn } from '../hooks/useGoogleSignIn'
import styles from './GoogleSignInButton.module.css'

export interface GoogleSignInButtonProps {
  onCredential: (idToken: string) => Promise<void>
  /** Rendered above the button when SSO is available — usually the "OR" divider. */
  divider?: React.ReactNode
}

/**
 * The entire single-sign-on block: divider, Google's own button, and any status message — or nothing
 * at all when the deployment has no Google configuration.
 *
 * Owning the divider as well as the button is what lets a password-only deployment render a clean
 * form with no orphaned "OR" separating the password field from empty space.
 *
 * This component previously took its Client ID from `env.googleClientId`, a build-time value, and was
 * never imported by anything. Sourcing the ID from `GET /api/auth/sso-config` instead means enabling
 * Google sign-in is a configuration change rather than a rebuild, and it lets the button advertise
 * which domains the server will actually accept.
 */
export function GoogleSignInButton({ onCredential, divider }: GoogleSignInButtonProps) {
  const sso = useGoogleSignIn(onCredential)

  if (sso.status === 'disabled') return null

  return (
    <>
      {divider}

      {/*
        Google renders its button INTO this node, so the node must exist before that call — it is
        therefore mounted during the initial config probe too, and merely collapsed until Google has
        actually drawn something, so no space is reserved for a button that may never appear.
      */}
      <div
        ref={sso.buttonRef}
        className={styles.buttonSlot}
        style={sso.status === 'ready' ? undefined : { height: 0, overflow: 'hidden' }}
      />

      {sso.status === 'ready' && sso.allowedDomains.length > 0 && (
        <p className={styles.domainHint}>Available for {sso.allowedDomains.join(', ')} accounts</p>
      )}

      {sso.status === 'error' && (
        <p className={styles.notConfigured}>
          {sso.error ?? 'Google sign-in is unavailable right now. Please use your email and password.'}
        </p>
      )}
    </>
  )
}
