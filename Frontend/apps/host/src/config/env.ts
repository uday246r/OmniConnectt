/**
 * Single point of access for build-time env vars — nowhere else in the app should read
 * `import.meta.env` directly. Fails loudly at startup if something required is missing, instead
 * of letting a blank API base URL silently produce confusing network errors later.
 */
function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required env var ${name}. Copy Frontend/apps/host/.env.example to .env and fill it in.`,
    )
  }
  return value
}

export const env = {
  authServiceUrl: required('VITE_AUTH_SERVICE_URL', import.meta.env.VITE_AUTH_SERVICE_URL),
  /** Deliberately optional — Google SSO stays off (LoginPage shows an honest "not configured" state) until this is set. */
  googleClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined,
  /** Kill-switch for real-time WebSocket connection. Enabled by default unless explicitly 'false'. */
  realtimeEnabled: import.meta.env.VITE_REALTIME_ENABLED !== 'false',
}
