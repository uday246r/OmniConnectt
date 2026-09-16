import { useAuthStore } from '../../features/auth/store/authStore'
import { env } from '../../config/env'

/**
 * The host's public runtime contract for every remote app. Deliberately NOT passed as React props —
 * loadRemoteAppModule renders `<LazyRemote />` with zero props (see remoteLoader.ts), and a remote
 * can mount long after login, or stay mounted across a token refresh. A global, live-read bridge
 * means a remote always reads the CURRENT access token/permissions at call time, never a stale
 * snapshot from whenever it happened to mount. Every remote app (Employee and any future one) uses
 * this instead of managing its own login/permission-check flow — see the host README's "Contract
 * for future remote apps" for the equivalent Module Federation contract.
 */
export interface OmniRemitHostBridge {
  /** Current in-memory access token, or null if not authenticated. Never persisted — see authStore's doc comment on why. */
  getAccessToken: () => string | null
  /** Same dedup'd refresh-then-return-token flow the host's own pages use before a mutation. Prefer this over getAccessToken() right before an API call, in case the token expired while the remote's UI (e.g. a modal) sat open. */
  ensureFreshAccessToken: () => Promise<string>
  /**
   * Mirrors authStore's own capability check. Administrators are always true; everyone else is
   * checked against the union of the JWT's cached `perms` claim and the fine-grained set the host
   * fetched at sign-in. No network call either way.
   *
   * The two sources are deliberately not distinguished here. A remote asks for
   * `hasCapability('remote.lead.dashboard', 'kpi.total-leads')` exactly as it asks for
   * `hasCapability('remote.lead.lead', 'View')`, and the host decides which delivery path answers.
   * That is what lets a remote declare a hundred widget capabilities without either side changing.
   *
   * It resolves what to RENDER. It is not a security boundary — every capability worth withholding
   * is also enforced by the service that owns the data.
   */
  hasCapability: (featureKey: string, capability: string) => boolean
  getUser: () => { id: string; name: string; email: string; isAdministrator: boolean } | null
  /** Base URLs so a remote's own API client doesn't have to guess or hardcode the host's environment. */
  apiBaseUrls: {
    authService: string
  }
  /**
   * Resolved design-token values, for the cases CSS inheritance cannot reach.
   *
   * Remotes render inside the host document, so `theme.css`'s `:root` custom properties ALREADY
   * inherit into remote DOM — a remote stylesheet can write `var(--omni-color-danger-600)` today and
   * it simply works. That remains the preferred route and needs nothing from this bridge.
   *
   * This exists for the cases that route cannot serve: a value needed in JavaScript rather than CSS —
   * a chart series color handed to recharts, an inline `style` computed from data, a canvas fill.
   * Those currently hardcode hex literals that drift from the palette silently.
   *
   * Reads live from the document at call time rather than snapshotting at boot, so a future theme
   * switch is picked up without remotes re-reading anything.
   */
  theme: {
    /** One token's computed value, e.g. token('--omni-color-danger-600') → '#dc2626'. Returns '' if undefined. */
    token: (name: string) => string
  }
  /*
   * Deliberately NO activity member either.
   *
   * A remote used to be able to write an audit row through this bridge. Audit rows are now written
   * exclusively by the service that performs the action, from the identity on the verified token —
   * a trail whose contents the browser can choose is not a trail. A remote that wants an action
   * recorded makes the action a real request; the endpoint records it.
   */
  /*
   * Deliberately NO navigation member.
   *
   * A remote's current page is passed down as the `page` prop by RemoteAppPage, and a remote asks to
   * move with the `onNavigate` callback it is handed alongside it — see
   * `pages/RemoteAppPage/RemoteAppPage.tsx` and each remote's `navigation/HostNavigation.tsx`.
   * Routing therefore stays inside React, where the router already is, rather than travelling
   * through a global mutable object that has no way to participate in rendering.
   */
}

declare global {
  interface Window {
    __omniremitHost__?: OmniRemitHostBridge
  }
}

/** Called once at boot (see main.tsx), before any remote can possibly load. */
export function installHostBridge() {
  window.__omniremitHost__ = {
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
