/**
 * Every permission a screen in this remote checks, written as `module:Capability`.
 *
 * These are the exact pairs the backend's `[RequiresCapability]` attributes enforce and publish to the
 * Role editor (`GET /permissions`). A screen that hid a button under any other name would be showing it
 * to people the server will refuse, or hiding it from people the server would allow.
 */
export const PERMISSIONS = {
  DASHBOARD_VIEW: 'dashboard:View',

  PRODUCTS_VIEW: 'products:View',
  PRODUCTS_CREATE: 'products:Create',
  PRODUCTS_EDIT: 'products:Edit',
  PRODUCTS_DELETE: 'products:Delete',
  PRODUCTS_EXPORT: 'products:Export',

  CATEGORIES_VIEW: 'categories:View',
  CATEGORIES_CREATE: 'categories:Create',
  CATEGORIES_EDIT: 'categories:Edit',
  CATEGORIES_DELETE: 'categories:Delete',

  // One word, like every module key on the platform; the page it opens is "sub-categories".
  SUBCATEGORIES_VIEW: 'subcategories:View',
  SUBCATEGORIES_CREATE: 'subcategories:Create',
  SUBCATEGORIES_EDIT: 'subcategories:Edit',
  SUBCATEGORIES_DELETE: 'subcategories:Delete',

  SETUP_VIEW: 'setup:View',
  SETUP_MANAGE: 'setup:Manage',

  AUDIT_LOGS_VIEW: 'audit:View',
  AUDIT_LOGS_EXPORT: 'audit:Export',
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Splits `module:Capability`. */
export function parsePermission(permission: PermissionKey): { module: string; capability: string } {
  const [module, capability] = permission.split(':');
  return { module, capability };
}
