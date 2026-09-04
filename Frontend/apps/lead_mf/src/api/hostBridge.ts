/**
 * OmniConnect Host Bridge Integration for lead_mf Remote App
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
  /**
   * The host owns the router, so this is how this remote's own page reaches the URL
   * (`/apps/lead/audit-logs`). Consumed through `useHostSubRoute` — see MainLayout. Optional
   * because a standalone run has no host at all.
   *
   * Replaces a `navigate: (to: string) => void` declared here that the host never implemented:
   * anything that had called it would have thrown.
   */
  navigation?: {
    getSubRoute: () => string;
    setSubRoute: (subRoute: string, options?: { replace?: boolean }) => void;
    onSubRouteChange: (listener: (subRoute: string) => void) => () => void;
  };
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
  if (!bridge && process.env.NODE_ENV === 'development') {
    console.debug(
      '[lead_mf] window.__omniremitHost__ is not installed — this remote is designed to run ' +
        'inside the OmniConnect host shell. API calls in standalone mode may require auth tokens.'
    );
  }
  return bridge ?? null;
};

export const isRunningInHost = (): boolean => Boolean(getBridge());

export const getAccessToken = (): string | null => getBridge()?.getAccessToken() ?? null;

export const ensureFreshAccessToken = (): Promise<string> =>
  getBridge()?.ensureFreshAccessToken() ??
  Promise.reject(new Error('lead_mf is not running inside the OmniConnect host — no access token available.'));

export const hasCapability = (featureKey: string, capability: string): boolean => {
  const bridge = getBridge();
  if (!bridge) {
    // When running in standalone dev mode without host, permit full access for previewing
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

// Permission Feature & Sub-Module Keys matching Backend/LeadService RequiresCapabilityAttribute
export const LEAD_FEATURE_KEY = 'remote.lead';
export const LEAD_SUBMODULE_LEAD = 'remote.lead.lead';
export const LEAD_SUBMODULE_DASHBOARD = 'remote.lead.dashboard';
export const LEAD_SUBMODULE_AUDIT = 'remote.lead.auditlog';
export const LEAD_SUBMODULE_MASTERDATA = 'remote.lead.masterdata';
export const LEAD_SUBMODULE_FIELD_SETTINGS = 'remote.lead.fieldsettings';

// Helper capability checks
export const canViewDashboard = (): boolean =>
  hasCapability(LEAD_SUBMODULE_DASHBOARD, 'View') || hasCapability(LEAD_FEATURE_KEY, 'View');

export const canViewLeads = (): boolean =>
  hasCapability(LEAD_SUBMODULE_LEAD, 'View') || hasCapability(LEAD_FEATURE_KEY, 'View');

export const canCreateLead = (): boolean =>
  hasCapability(LEAD_SUBMODULE_LEAD, 'Create') || hasCapability(LEAD_FEATURE_KEY, 'Create');

export const canEditLead = (): boolean =>
  hasCapability(LEAD_SUBMODULE_LEAD, 'Edit') || hasCapability(LEAD_FEATURE_KEY, 'Edit');

export const canDeleteLead = (): boolean =>
  hasCapability(LEAD_SUBMODULE_LEAD, 'Delete') || hasCapability(LEAD_FEATURE_KEY, 'Delete');

export const canViewAuditLogs = (): boolean =>
  hasCapability(LEAD_SUBMODULE_AUDIT, 'View') || hasCapability(LEAD_FEATURE_KEY, 'View');

export const canManageFieldSettings = (): boolean =>
  hasCapability(LEAD_SUBMODULE_FIELD_SETTINGS, 'Manage') || hasCapability(LEAD_FEATURE_KEY, 'View');
