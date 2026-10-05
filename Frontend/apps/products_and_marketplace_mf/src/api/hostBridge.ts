/**
 * The Products & Marketplace remote's only line to the host shell.
 *
 * The host owns sign-in, the token and the user's permissions. This remote never logs anyone in and
 * never decides a permission by itself: it asks the bridge the host installs on `window`, exactly as
 * Lead Management and Customer 360 do.
 */

// The contract is shared with the host and versioned (@omniconnect/host-bridge): a field one side
// invents is a bug the type checker can no longer see. This app's package.json states the range
// of contract versions it was written against (omniconnect.requiredHostBridge).
import type { HostBridgeUser, OmniConnectHostBridge } from '@omniconnect/host-bridge';

export type { HostBridgeUser, OmniConnectHostBridge };

export const getBridge = (): OmniConnectHostBridge | null =>
  typeof window === 'undefined' ? null : (window.__omniconnectHost__ ?? null);

export const isRunningInHost = (): boolean => getBridge() !== null;

export const getAccessToken = (): string | null => getBridge()?.getAccessToken() ?? null;

export const ensureFreshAccessToken = (): Promise<string> =>
  getBridge()?.ensureFreshAccessToken() ??
  Promise.reject(new Error('Products & Marketplace is not running inside the host, so there is no session to refresh.'));

export const getCurrentUser = (): HostBridgeUser | null => getBridge()?.getUser() ?? null;

/**
 * The key this app was registered under in Setup → Applications. Every permission it checks is
 * `remote.<appKey>.<module>:<Capability>`, the same string the backend enforces — so re-registering the
 * app under another key is a build variable, not a code change.
 */
export const APP_KEY: string = (import.meta.env.VITE_APP_KEY as string | undefined)?.trim() || 'products';

export const featureKeyFor = (module: string): string => `remote.${APP_KEY.toLowerCase()}.${module.toLowerCase()}`;

/**
 * Whether the signed-in user holds `module:Capability`.
 *
 * Standalone (a remote's own dev server, with no host) grants everything so screens can be previewed;
 * the backend still refuses every call without a real token, so nothing is actually opened up.
 */
export const hasCapability = (module: string, capability: string): boolean => {
  const bridge = getBridge();
  if (!bridge) return true;
  if (bridge.getUser()?.isAdministrator) return true;
  return bridge.hasCapability(featureKeyFor(module), capability);
};
