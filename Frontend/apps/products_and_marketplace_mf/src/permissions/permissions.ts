/**
 * Every permission a screen in this remote checks, written as `module:Capability`.
 *
 * These are the exact pairs the backend's `[RequiresCapability]` attributes enforce and publish to the
 * Role editor. This list used to be its own vocabulary ("product_marketplace.products.view") that the
 * host never issues, and it was granted in full to every user — so each button appeared for everyone
 * and the server was the only thing (had it been checking) that would have said no.
 */
export const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard:View',

  PRODUCTS_VIEW: 'products:View',
  PRODUCTS_CREATE: 'products:Create',
  PRODUCTS_EDIT: 'products:Edit',
  PRODUCTS_DELETE: 'products:Delete',
  PRODUCTS_APPLY: 'products:Apply',

  CATEGORIES_VIEW: 'categories:View',
  CATEGORIES_CREATE: 'categories:Create',
  CATEGORIES_EDIT: 'categories:Edit',
  CATEGORIES_DELETE: 'categories:Delete',

  REVIEWS_VIEW: 'reviews:View',
  REVIEWS_MANAGE: 'reviews:Moderate',

  PROMOTIONS_VIEW: 'promotions:View',
  PROMOTIONS_CREATE: 'promotions:Create',
  PROMOTIONS_EDIT: 'promotions:Edit',
  PROMOTIONS_DELETE: 'promotions:Delete',

  APPLICATIONS_VIEW: 'applications:View',
  // Moving an application forward, approving and rejecting are one permission on the server.
  APPLICATIONS_MANAGE: 'applications:Manage',
  APPLICATIONS_APPROVE: 'applications:Manage',
  APPLICATIONS_REJECT: 'applications:Manage',

  AUDIT_LOGS_VIEW: 'audit:View',
  AUDIT_LOGS_EXPORT: 'audit:Export',

  SETUP_VIEW: 'setup:View',
  SETUP_MANAGE: 'setup:Manage',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Splits `module:Capability`. */
export function parsePermission(permission: PermissionKey): { module: string; capability: string } {
  const [module, capability] = permission.split(':');
  return { module, capability };
}
