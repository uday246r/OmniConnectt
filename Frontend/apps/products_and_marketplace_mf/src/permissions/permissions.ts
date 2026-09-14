/**
 * Canonical permission keys for the Product Marketplace remote.
 * The Host App is expected to supply the actual granted set at runtime via PermissionProvider;
 * until then, MockPermissionProvider grants a fixed local set for standalone development.
 */
export const PERMISSIONS = {
  DASHBOARD_VIEW: "product_marketplace.dashboard.view",

  PRODUCTS_VIEW: "product_marketplace.products.view",
  PRODUCTS_CREATE: "product_marketplace.products.create",
  PRODUCTS_EDIT: "product_marketplace.products.edit",
  PRODUCTS_DELETE: "product_marketplace.products.delete",
  PRODUCTS_APPLY: "product_marketplace.products.apply",

  CATEGORIES_VIEW: "product_marketplace.categories.view",
  CATEGORIES_CREATE: "product_marketplace.categories.create",
  CATEGORIES_EDIT: "product_marketplace.categories.edit",
  CATEGORIES_DELETE: "product_marketplace.categories.delete",

  REVIEWS_VIEW: "product_marketplace.reviews.view",
  REVIEWS_MANAGE: "product_marketplace.reviews.manage",

  PROMOTIONS_VIEW: "product_marketplace.promotions.view",
  PROMOTIONS_CREATE: "product_marketplace.promotions.create",
  PROMOTIONS_EDIT: "product_marketplace.promotions.edit",
  PROMOTIONS_DELETE: "product_marketplace.promotions.delete",

  APPLICATIONS_VIEW: "product_marketplace.applications.view",
  APPLICATIONS_MANAGE: "product_marketplace.applications.manage",
  APPLICATIONS_APPROVE: "product_marketplace.applications.approve",
  APPLICATIONS_REJECT: "product_marketplace.applications.reject",

  AUDIT_LOGS_VIEW: "product_marketplace.audit_logs.view",

  SETUP_VIEW: "product_marketplace.setup.view",
  SETUP_MANAGE: "product_marketplace.setup.manage",
} as const;

export type PermissionKey = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

/** Full grant set used for standalone/local development until the Host App supplies real permissions. */
export const ALL_PERMISSIONS: PermissionKey[] = Object.values(PERMISSIONS);
