import { HOST_BRIDGE_VERSION, type OmniConnectHostBridge } from '@omniconnect/host-bridge'
import { useAuthStore } from '../../features/auth/store/authStore'
import { env } from '../../config/env'

/**
 * The host's implementation of the runtime contract every remote app reads (window.__omniconnectHost__).
 * The contract itself — its members, why each exists, and how it is versioned — lives in
 * @omniconnect/host-bridge, shared with the remotes, so the two sides cannot drift.
 *
 * Deliberately NOT passed as React props: a remote can mount long after login, or stay mounted across a
 * token refresh. A global, live-read bridge means a remote always reads the CURRENT token/permissions at
 * call time, never a stale snapshot from whenever it happened to mount.
 *
 * There is deliberately no activity member (audit rows are written by the service that performs an
 * action, never by the browser) and no navigation member (a remote is handed `page`, `subPath` and
 * `onNavigate` as props by RemoteAppPage, so routing stays inside React).
 */
export type { OmniConnectHostBridge }

/** Called once at boot (see main.tsx), before any remote can possibly load. */
export function installHostBridge() {
  window.__omniconnectHost__ = {
    bridgeVersion: HOST_BRIDGE_VERSION,
    getAccessToken: () => useAuthStore.getState().accessToken,
    ensureFreshAccessToken: () => useAuthStore.getState().ensureFreshAccessToken(),
    hasCapability: (featureKey, capability) => useAuthStore.getState().hasCapability(featureKey, capability),
    getUser: () => {
      const user = useAuthStore.getState().user
      return user ? { id: user.id, name: user.name, email: user.email, isAdministrator: user.isAdministrator } : null
    },
    apiBaseUrls: {
      authService: env.authServiceUrl,
    },
    theme: {
      token: (name) => {
        // Normalized so both token('--omni-color-danger-600') and token('omni-color-danger-600')
        // work — a remote author should not have to remember which form the bridge wants.
        const property = name.startsWith('--') ? name : `--${name}`
        return getComputedStyle(document.documentElement).getPropertyValue(property).trim()
      },
    },
  }
}
