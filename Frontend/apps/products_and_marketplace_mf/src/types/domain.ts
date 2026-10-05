/**
 * The shapes the Products & Marketplace API returns and accepts.
 *
 * Statuses are deliberately plain `string`s, never unions: which values exist, what they are called,
 * what colour they are and whether they make a record live are all decided in Setup, so nothing in this
 * app may compare a status to a literal. Ask the status store (`useStatusConfigStore`) instead.
 */

import type { BadgeTone, DateRangeValue } from '@omniconnect/ui';

export type { DateRangeValue };

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface StatusCount {
  status: string;
  count: number;
}

// ---- Setup → Statuses -----------------------------------------------------------------------------

/** How a status is drawn. One vocabulary, defined by the shared badge, not re-typed here. */
export type StatusTone = BadgeTone;

/** Which kind of record a status belongs to ("Product", "SubCategory", "Category") — whatever the server groups them under. */
export type StatusEntityType = string;

export interface StatusConfig {
  id: string;
  entityType: StatusEntityType;
  value: string;
  label: string;
  color: StatusTone;
  enabled: boolean;
  /** Whether a record holding this status is live in the catalogue. */
  isLive: boolean;
  sortOrder: number;
}

export interface StatusConfigInput {
  label: string;
  color: StatusTone;
  enabled: boolean;
  isLive: boolean;
  sortOrder: number;
}

export interface StatusConfigCreateInput extends StatusConfigInput {
  entityType: StatusEntityType;
  value: string;
}

// ---- Fields (the attributes a sub-category's products carry) --------------------------------------

/** The server's field types. The field editor offers exactly these. */
export const FIELD_DATA_TYPES = ['Text', 'Number', 'Currency', 'Percentage', 'Boolean', 'Date', 'Dropdown', 'MultiSelect'] as const;
export type FieldDataType = (typeof FIELD_DATA_TYPES)[number];

export interface FieldRule {
  type: string;
  pattern?: string | null;
  value?: number | null;
  message: string;
}

export interface FieldDefinition {
  id: string;
  subCategoryId: string;
  key: string;
  label: string;
  dataType: FieldDataType;
  unit?: string | null;
  options?: string[] | null;
  validations: FieldRule[];
  required: boolean;
  filterable: boolean;
  sortable: boolean;
  displayOnCard: boolean;
  displayOnDetails: boolean;
  isReadOnly: boolean;
  isPrimaryMetric: boolean;
  isSecondaryMetric: boolean;
  sortOrder: number;
}

export type FieldDefinitionInput = Omit<FieldDefinition, 'id' | 'subCategoryId' | 'key'> & { key?: string };

// ---- Categories and sub-categories ----------------------------------------------------------------

export interface Category {
  id: string;
  name: string;
  code: string;
  description: string;
  iconKey: string;
  status: string;
  /** Whether the category's status is live. When it is not, everything beneath it is hidden. */
  isLive: boolean;
  displayOrder: number;
  subCategoryCount: number;
  /** Products beneath it, whatever their status. */
  productCount: number;
  createdAt: string;
}

export interface CategoryInput {
  name: string;
  code: string;
  description: string;
  iconKey: string;
  status: string;
  displayOrder: number;
}

export interface SubCategory {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryCode: string;
  name: string;
  code: string;
  description: string;
  iconKey: string;
  status: string;
  isLive: boolean;
  displayOrder: number;
  productCount: number;
  createdAt: string;
}

/** A sub-category with the attributes its products carry — what the product form renders from. */
export interface SubCategoryDetail extends SubCategory {
  fieldDefinitions: FieldDefinition[];
}

export interface SubCategoryInput {
  categoryId: string;
  name: string;
  code: string;
  description: string;
  iconKey: string;
  status: string;
  displayOrder: number;
}

// ---- Products -------------------------------------------------------------------------------------

export interface ProductFieldValue {
  fieldDefinitionId: string;
  key: string;
  label: string;
  dataType: FieldDataType;
  unit?: string | null;
  value: string;
  displayOnCard: boolean;
  displayOnDetails: boolean;
}

export interface ProductListItem {
  id: string;
  name: string;
  code: string;
  shortDescription: string;
  iconKey: string;
  status: string;
  /** The catalogue shows it: its own status, its sub-category's and its category's are all live. */
  isVisible: boolean;
  categoryId: string;
  categoryName: string;
  subCategoryId: string;
  subCategoryName: string;
  subCategoryCode: string;
  cardFields: ProductFieldValue[];
  featureTags: string[];
  createdAt: string;
  updatedAt: string;
}

export interface ProductBenefit {
  id: string;
  title: string;
  description: string;
  iconKey: string;
}

export interface ProductEligibility {
  id: string;
  criteria: string;
  description: string;
}

export interface ProductDetail extends ProductListItem {
  description: string;
  detailFields: ProductFieldValue[];
  benefits: ProductBenefit[];
  eligibilityCriteria: ProductEligibility[];
  viewCount: number;
}

export interface ProductInput {
  subCategoryId: string;
  name: string;
  code: string;
  shortDescription: string;
  description: string;
  iconKey: string;
  status: string;
  fieldValues: { fieldDefinitionId: string; value: string }[];
  benefits: { title: string; description: string; iconKey: string }[];
  eligibilityCriteria: { criteria: string; description: string }[];
}

// ---- Documents ------------------------------------------------------------------------------------

export interface DocumentDefinition {
  id: string;
  name: string;
  documentType: string;
  required: boolean;
  sortOrder: number;
  active: boolean;
  /** Null when the document applies to every product. */
  subCategoryId: string | null;
  subCategoryName: string | null;
  createdAt: string;
}

export interface DocumentDefinitionInput {
  name: string;
  documentType: string;
  required: boolean;
  sortOrder: number;
  active: boolean;
  subCategoryId: string | null;
}

// ---- Dashboard ------------------------------------------------------------------------------------

/** One headline figure. It carries a key, not a label: naming it is this app's job. */
export interface Kpi {
  key: string;
  value: number;
  changePercent: number;
}

export interface DashboardSummary {
  totalProducts: Kpi;
  liveProducts: Kpi;
  unpublishedProducts: Kpi;
  totalCategories: Kpi;
  totalSubCategories: Kpi;
  comparedDays: number;
  rangeStart: string;
  rangeEnd: string;
}

export interface CatalogBreakdown {
  id: string;
  name: string;
  code: string;
  count: number;
}

export interface StatusDistribution {
  status: string;
  count: number;
  percentage: number;
}

export interface RecentProduct {
  id: string;
  name: string;
  code: string;
  categoryName: string;
  subCategoryName: string;
  iconKey: string;
  status: string;
  createdAt: string;
}

export interface RecentActivity {
  id: string;
  action: string;
  entityType: string;
  entityName: string;
  actorName: string;
  timestamp: string;
}

// ---- Audit ----------------------------------------------------------------------------------------

export interface AuditLog {
  id: string;
  timestamp: string;
  actorName: string;
  actorEmail: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  entityName: string;
  description: string;
  success: boolean;
  previousValue?: string | null;
  newValue?: string | null;
  ipAddress?: string | null;
}

export interface AuditActionOption {
  value: string;
  label: string;
}

export interface AuditLogSummary {
  totalCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  actionTypeCount: number;
  entityTypeCount: number;
}
