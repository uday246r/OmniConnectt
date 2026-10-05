import { HOST_BRIDGE_VERSION, type HostBridgeUser, type OmniConnectHostBridge } from './contract'

/**
 * A complete host bridge for a remote's tests, overridable member by member.
 *
 * Each remote used to hand-build its own fake, which is how the copies came to carry `roleName` and
 * `permissions` the host never sends: a fake that compiles against a private copy of the contract
 * proves nothing about the real host. Built from the shared contract, a fake that drifts no longer
 * compiles.
 */
export function createFakeHostBridge(over: Partial<OmniConnectHostBridge> = {}): OmniConnectHostBridge {
  const user: HostBridgeUser = { id: 'u1', name: 'Tester', email: 'tester@example.com', isAdministrator: false }
  return {
    bridgeVersion: HOST_BRIDGE_VERSION,
    getAccessToken: () => 'token',
    ensureFreshAccessToken: () => Promise.resolve('token'),
    hasCapability: () => false,
    getUser: () => user,
    apiBaseUrls: { authService: '' },
    theme: { token: () => '' },
    ...over,
  }
}
