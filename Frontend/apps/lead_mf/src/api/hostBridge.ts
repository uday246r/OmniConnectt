/**
 * OmniConnect Host Bridge Integration for lead_mf Remote App
 * Provides seamless auth token propagation, permission checking, and navigation hooks
 * conforming with the OmniConnect Host App remote architecture.
 */

// The contract is shared with the host and versioned (@omniconnect/host-bridge): a field one side
// invents is a bug the type checker can no longer see. This app's package.json states the range
// of contract versions it was written against (omniconnect.requiredHostBridge).
import type { HostBridgeUser, OmniConnectHostBridge } from '@omniconnect/host-bridge';

export type { HostBridgeUser, OmniConnectHostBridge };

export const getBridge = (): OmniConnectHostBridge | null => {
  if (typeof window === 'undefined') return null;
  const bridge = window.__omniconnectHost__;
  // import.meta.env.DEV (Vite's own flag), not process.env.NODE_ENV — `process` is never polyfilled
  // for the browser bundle in this app's vite.config, so the old check threw
  // `ReferenceError: process is not defined` the moment this ran with no bridge installed, e.g. this
  // remote loaded standalone (`vite preview`) outside the host shell.
  if (!bridge && import.meta.env.DEV) {
    console.debug(
      '[lead_mf] window.__omniconnectHost__ is not installed — this remote is designed to run ' +
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

/**
 * Changing field settings — exactly Field Settings:Manage, which is what the server's PUT requires. It
 * used to also accept the app-level View, so anyone allowed into Lead Management was shown a Save
 * button whose every press came back 403.
 */
export const canManageFieldSettings = (): boolean => hasCapability(LEAD_SUBMODULE_FIELD_SETTINGS, 'Manage');

/*
 * Business capabilities — the dashboard's individual cards and charts, and the audit export.
 *
 * They go through the same bridge call as everything above and cost no more to ask about: the host
 * merges what the token carries with what it fetched separately, so this side never learns which of
 * the two answered.
 *
 * The difference from the helpers above is the missing fallback. Those accept the parent
 * `remote.lead:View` as sufficient, which is right for a module-level read. It would be wrong here:
 * being allowed into the app at all must not imply every KPI card inside it, or the per-card grant
 * would exist and mean nothing.
 */

/** One dashboard card or chart, e.g. `kpi.total-leads`. Named by the manifest, never invented here. */
export const canSeeDashboardCapability = (capabilityKey: string): boolean =>
  hasCapability(LEAD_SUBMODULE_DASHBOARD, capabilityKey);

export const canExportAuditLogs = (): boolean =>
  hasCapability(LEAD_SUBMODULE_AUDIT, 'export.csv');
