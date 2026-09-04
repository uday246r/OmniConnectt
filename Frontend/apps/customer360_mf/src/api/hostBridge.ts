/**
 * OmniConnect Host Bridge Integration for customer360_mf Remote App
 * Provides seamless auth token propagation, permission checking, and navigation hooks
 * conforming with the OmniRemit Host App remote architecture.
 */

export interface HostBridgeUser {
  id: string;
  name: string;
  email: string;
  isAdministrator: boolean;
  roleName: string | null;
  permissions: string[];
}

export interface OmniRemitHostBridge {
  getAccessToken: () => string | null;
  ensureFreshAccessToken: () => Promise<string>;
  hasCapability: (featureKey: string, capability: string) => boolean;
  getUser: () => HostBridgeUser | null;
  navigate: (to: string) => void;
  apiBaseUrls?: {
    authService: string;
    moduleRegistry: string;
  };
}

declare global {
  interface Window {
    __omniremitHost__?: OmniRemitHostBridge;
  }
}

export const getBridge = (): OmniRemitHostBridge | null => {
  if (typeof window === 'undefined') return null;
  const bridge = window.__omniremitHost__;
  // import.meta.env.DEV (Vite's own flag), not process.env.NODE_ENV — `process` is never polyfilled
  // for the browser bundle in this app's vite.config, so the old check threw
  // `ReferenceError: process is not defined` the moment this ran with no bridge installed, e.g. this
  // remote loaded standalone (`vite preview`) outside the host shell.
  if (!bridge && import.meta.env.DEV) {
    console.debug(
      '[customer360_mf] window.__omniremitHost__ is not installed — this remote is designed to run ' +
        'inside the OmniConnect host shell. API calls in standalone mode may require auth tokens.'
    );
  }
  return bridge ?? null;
};

export const isRunningInHost = (): boolean => Boolean(getBridge());

export const getAccessToken = (): string | null => getBridge()?.getAccessToken() ?? null;

export const ensureFreshAccessToken = (): Promise<string> =>
  getBridge()?.ensureFreshAccessToken() ??
  Promise.reject(new Error('customer360_mf is not running inside the OmniConnect host — no access token available.'));

export const hasCapability = (featureKey: string, capability: string): boolean => {
  const bridge = getBridge();
  if (!bridge) {
    // In standalone dev mode without host, allow full access for preview
    return true;
  }
  const user = bridge.getUser();
  if (user?.isAdministrator) {
    return true;
  }
  return bridge.hasCapability(featureKey, capability);
};

export const getCurrentUser = (): HostBridgeUser | null => getBridge()?.getUser() ?? null;

export const getAuthServiceBaseUrl = (): string => getBridge()?.apiBaseUrls?.authService ?? '';

// Permission Feature & Sub-Module Keys matching Backend/Customer360Service
export const C360_FEATURE_KEY = 'remote.customer360';
export const C360_SUBMODULE_PROFILE = 'remote.customer360.profile';
export const C360_SUBMODULE_PRODUCTS = 'remote.customer360.products';
export const C360_SUBMODULE_INTERACTIONS = 'remote.customer360.interactions';
export const C360_SUBMODULE_CONTACT = 'remote.customer360.contact';
export const C360_SUBMODULE_AUDIT = 'remote.customer360.audit';
// Matches Backend/Customer360Service/Controllers/FieldConfigController.cs's
// [RequiresCapability("fieldsettings", ...)] — PermissionsController on that service discovers this
// automatically by reflection, so nothing needs registering by hand on the host/ModuleRegistry side.
export const C360_SUBMODULE_FIELD_SETTINGS = 'remote.customer360.fieldsettings';

// Capability checks
export const canViewProfile = (): boolean =>
  hasCapability(C360_SUBMODULE_PROFILE, 'View') || hasCapability(C360_FEATURE_KEY, 'View');

export const canViewProducts = (): boolean =>
  hasCapability(C360_SUBMODULE_PRODUCTS, 'View') || hasCapability(C360_FEATURE_KEY, 'View');

export const canViewInteractions = (): boolean =>
  hasCapability(C360_SUBMODULE_INTERACTIONS, 'View') || hasCapability(C360_FEATURE_KEY, 'View');

export const canViewAuditLogs = (): boolean =>
  hasCapability(C360_SUBMODULE_AUDIT, 'View') || hasCapability(C360_FEATURE_KEY, 'View');

export const canManageFieldSettings = (): boolean =>
  hasCapability(C360_SUBMODULE_FIELD_SETTINGS, 'Manage') || hasCapability(C360_FEATURE_KEY, 'View');

/*
 * Business capabilities — the panels of the 360 view, and the audit export.
 *
 * Same bridge call as everything above; the host merges what the token carries with what it fetched
 * separately, so this side never learns which answered.
 *
 * Deliberately without the `|| hasCapability(C360_FEATURE_KEY, 'View')` fallback the helpers above
 * use. That fallback is right for a module-level read, and wrong here: being allowed into the app
 * must not imply every panel inside it, or the per-panel grant would exist and mean nothing.
 */

/** One panel of the customer 360 view, e.g. `panel.contacts`. Named by the manifest. */
export const canSeeProfilePanel = (capabilityKey: string): boolean =>
  hasCapability(C360_SUBMODULE_PROFILE, capabilityKey);

export const canExportAuditLogs = (): boolean =>
  hasCapability(C360_SUBMODULE_AUDIT, 'export.csv');
