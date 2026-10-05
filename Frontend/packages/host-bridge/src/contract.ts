/**
 * The runtime contract between the OmniConnect host shell and every remote app — one definition, used
 * by the host to implement it and by each remote to consume it.
 *
 * It used to be copied into each remote, and the copies had drifted: all three declared `roleName`
 * and `permissions` on the user, which the host never supplied. A field one side invents is a bug the
 * type checker can no longer see, so the contract lives here, versioned.
 *
 * VERSIONING. `HOST_BRIDGE_VERSION` is SemVer for this contract, not for any app:
 *   - add an optional member or prop  → MINOR
 *   - remove or change one            → MAJOR (remotes declaring `^old` will be refused)
 * A remote states the range it needs in its package.json (`omniconnect.requiredHostBridge`); the build
 * copies it into mf-manifest.json, AuthService refuses to promote a remote the live host does not
 * satisfy, and the host refuses to mount one — so an incompatible pair fails as a clear message, not
 * as "undefined is not a function" in front of a user.
 */

/** The contract version the host implements. Bump it with every change to this file. */
export const HOST_BRIDGE_VERSION = '1.1.0'

export interface HostBridgeUser {
  id: string
  name: string
  email: string
  isAdministrator: boolean
}

export interface OmniConnectHostBridge {
  /** Which contract this host implements. Absent on hosts older than 1.1.0. */
  bridgeVersion?: string
  /** Current in-memory access token, or null if not authenticated. */
  getAccessToken: () => string | null
  /**
   * Refresh-if-needed then return the token. Prefer this right before an API call, in case the token
   * expired while the remote's UI (e.g. a modal) sat open.
   */
  ensureFreshAccessToken: () => Promise<string>
  /**
   * What the signed-in user may see. Administrators are always true. It resolves what to RENDER; it is
   * not a security boundary — every capability worth withholding is also enforced by the service that
   * owns the data.
   */
  hasCapability: (featureKey: string, capability: string) => boolean
  getUser: () => HostBridgeUser | null
  /** Base URLs, so a remote's own API client does not guess the host's environment. Empty = same origin. */
  apiBaseUrls: {
    authService: string
  }
  /** Resolved design-token values, for the cases CSS inheritance cannot reach (charts, canvas). */
  theme: {
    /** token('--omni-color-danger-600') → '#dc2626'; '' if undefined. */
    token: (name: string) => string
  }
}

/** The props the host passes to every remote's exported `App`. */
export interface RemoteAppProps {
  /** The page segment from /apps/<key>/<page>. */
  page?: string
  /** Whatever follows the page (since 1.1.0): "123" for /apps/lead/view-lead/123. */
  subPath?: string
  /** Ask the host to move to another of this app's pages. */
  onNavigate?: (page: string) => void
}

declare global {
  interface Window {
    __omniconnectHost__?: OmniConnectHostBridge
  }
}
