import { useAuthStore } from '../../features/auth/store/authStore'
import { env } from '../../config/env'
import { readSubRoute, subscribeSubRoute, writeSubRoute } from './hostNavigation'

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
  /** Mirrors authStore's own capability check — administrators always true, everyone else checked against the JWT's cached `perms` claim. No network call. */
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
  /**
   * Puts a remote's own page in the URL.
   *
   * The host owns the router; a remote renders at `/apps/:appKey/*` and cannot call `navigate()`
   * itself. Without this a remote's internal page lived only in its own state, so `/apps/lead` was
   * the URL for every page inside Lead Management — refresh, Back and shared links all dropped the
   * reader back on the remote's default page.
   *
   * A remote calls `setSubRoute` when its page changes and subscribes with `onSubRouteChange` to
   * follow Back/Forward. Both are safe to call before the host router has finished mounting.
   */
  navigation: {
    /** The path segment after `/apps/:appKey/`, or '' at the app's own root. */
    getSubRoute: () => string
    /** Writes the segment into the URL. `replace: true` for the initial sync, so it adds no history entry. */
    setSubRoute: (subRoute: string, options?: { replace?: boolean }) => void
    /** Fires when the sub-route changes from outside the remote (Back/Forward, a host link). Returns an unsubscribe. */
    onSubRouteChange: (listener: (subRoute: string) => void) => () => void
  }
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
    navigation: {
      getSubRoute: readSubRoute,
      setSubRoute: writeSubRoute,
      onSubRouteChange: subscribeSubRoute,
    },
  }
}
