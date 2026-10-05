/**
 * Single point of access for build-time env vars — nowhere else in the app should read
 * `import.meta.env` directly.
 */

/**
 * Where AuthService is reached. Empty — the default — means the host's own origin: the platform
 * publishes AuthService at `/api` and `/hubs` on the same domain as the shell (nginx in production,
 * the host dev server's proxy in development), so one build runs unchanged in every environment and
 * the refresh cookie is first-party. Set VITE_AUTH_SERVICE_URL only to reach AuthService on another
 * origin. A trailing slash is dropped so every caller can append `/api/...` without doubling it.
 */
const authServiceUrl = (import.meta.env.VITE_AUTH_SERVICE_URL ?? '').trim().replace(/\/+$/, '')

export const env = {
  authServiceUrl,
  /** Deliberately optional — Google SSO stays off (LoginPage shows an honest "not configured" state) until this is set. */
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined,
  /** Kill-switch for real-time WebSocket connection. Enabled by default unless explicitly 'false'. */
  realtimeEnabled: import.meta.env.VITE_REALTIME_ENABLED !== 'false',
}
