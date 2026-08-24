import { useEffect, useRef, useState } from 'react'
import { authServiceClient, type SsoConfigDto } from '../../../shared/api/authServiceClient'

/**
 * Wires Google Identity Services to the SSO endpoints AuthService already exposes.
 *
 * The backend half of Google sign-in has been complete for some time — `POST /api/auth/google`
 * verifies the ID token with Google's own libraries, enforces the configured domain allowlist, and
 * refuses any identity without a provisioned active account. What was missing was the browser half:
 * the login page rendered a button that only ever displayed "Corporate SSO is active for enterprise
 * domains. Please contact your administrator." and never called anything.
 *
 * Availability is driven entirely by `GET /api/auth/sso-config`, which reports whether a Client ID
 * and an allowed-domain list are configured. Deployments without Google set up therefore show no SSO
 * button at all, rather than one that cannot work — and turning SSO on is purely a configuration
 * change, needing no rebuild.
 */

const GIS_SRC = 'https://accounts.google.com/gsi/client'

type GoogleIdConfig = {
  client_id: string
  callback: (response: { credential?: string }) => void
  cancel_on_tap_outside?: boolean
}

type GoogleButtonOptions = {
  type?: 'standard' | 'icon'
  theme?: 'outline' | 'filled_blue' | 'filled_black'
  size?: 'small' | 'medium' | 'large'
  text?: 'signin_with' | 'signup_with' | 'continue_with'
  shape?: 'rectangular' | 'pill'
  width?: number
  logo_alignment?: 'left' | 'center'
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: GoogleIdConfig) => void
          renderButton: (parent: HTMLElement, options: GoogleButtonOptions) => void
        }
      }
    }
  }
}

/** Loaded once per document, even if the hook mounts more than once. */
let gisLoader: Promise<void> | null = null

function loadGis(): Promise<void> {
  if (window.google?.accounts?.id) return Promise.resolve()
  if (gisLoader) return gisLoader

  gisLoader = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GIS_SRC}"]`)
    if (existing) {
      existing.addEventListener('load', () => resolve())
      existing.addEventListener('error', () => reject(new Error('Google sign-in failed to load.')))
      return
    }
    const script = document.createElement('script')
    script.src = GIS_SRC
    script.async = true
    script.defer = true
    script.onload = () => resolve()
    script.onerror = () => {
      // Let a later attempt retry rather than caching the failure forever — this is usually a
      // transient network problem or a blocked third-party script, not a permanent condition.
      gisLoader = null
      reject(new Error('Google sign-in failed to load.'))
    }
    document.head.appendChild(script)
  })

  return gisLoader
}

export type GoogleSignInStatus = 'checking' | 'disabled' | 'ready' | 'error'

export interface GoogleSignInState {
  status: GoogleSignInStatus
  /** Domains the server will accept, so the UI can say so before the user tries. */
  allowedDomains: string[]
  error: string | null
  /** Attach to the element Google should render its button into. */
  buttonRef: React.RefObject<HTMLDivElement | null>
}

export function useGoogleSignIn(onCredential: (idToken: string) => Promise<void>): GoogleSignInState {
  const [status, setStatus] = useState<GoogleSignInStatus>('checking')
  const [allowedDomains, setAllowedDomains] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const buttonRef = useRef<HTMLDivElement | null>(null)

  // Kept in a ref so re-initialising Google is never necessary just because the parent re-rendered
  // and handed us a new function identity.
  const onCredentialRef = useRef(onCredential)
  onCredentialRef.current = onCredential

  useEffect(() => {
    let cancelled = false

    async function setup() {
      let config: SsoConfigDto
      try {
        config = await authServiceClient.ssoConfig()
      } catch {
        // A login page must still work when this probe fails, so an unreachable config endpoint
        // simply means "no SSO offered" rather than an error banner over the password form.
        if (!cancelled) setStatus('disabled')
        return
      }
      if (cancelled) return

      if (!config.googleEnabled) {
        setStatus('disabled')
        return
      }
      setAllowedDomains(config.allowedDomains ?? [])

      try {
        await loadGis()
      } catch (err) {
        if (!cancelled) {
          setStatus('error')
          setError(err instanceof Error ? err.message : 'Google sign-in failed to load.')
        }
        return
      }
      if (cancelled || !buttonRef.current) return

      const gis = window.google?.accounts?.id
      if (!gis) {
        setStatus('error')
        setError('Google sign-in failed to load.')
        return
      }

      /*
       * The Client ID is fetched from the server rather than baked into the bundle. It is not a
       * secret — Google publishes it in the page — but sourcing it from config means the same build
       * runs in every environment, and rotating it never requires a redeploy.
       */
      gis.initialize({
        client_id: config.clientId,
        callback: (response) => {
          if (!response.credential) return
          void onCredentialRef.current(response.credential)
        },
        cancel_on_tap_outside: true,
      })

      gis.renderButton(buttonRef.current, {
        type: 'standard',
        theme: 'outline',
        size: 'large',
        text: 'continue_with',
        shape: 'rectangular',
        logo_alignment: 'center',
      })

      setStatus('ready')
    }

    void setup()
    return () => {
      cancelled = true
    }
  }, [])

  return { status, allowedDomains, error, buttonRef }
}
