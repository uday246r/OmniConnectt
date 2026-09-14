// Status values are no longer a closed set - Setup can add new ones for any entity type (see
// StatusConfig), so these are plain strings rather than fixed unions. The type aliases are kept so
// call sites stay self-documenting about which kind of status a value holds.
export type ProductStatus = string;
export type CategoryStatus = string;
export type FieldDataType = "Text" | "Number" | "Currency" | "Percentage" | "Boolean" | "Date" | "Dropdown" | "MultiSelect";
export type ReviewStatus = string;
export type PromotionStatus = string;
export type ApplicationStatus = string;

export type SortOption = "recommended" | "trending" | "lowest-rate" | "newly-added" | "top-rated" | "most-applied";

export type StatusEntityType = "Product" | "Category" | "Review" | "Promotion" | "Application";
export type StatusTone = "success" | "warning" | "danger" | "info" | "neutral";

export interface StatusConfig {
  id: string;
  entityType: StatusEntityType;
  value: string;
  label: string;
  color: StatusTone;
  enabled: boolean;
  sortOrder: number;
}

export interface StatusConfigInput {
  label: string;
  color: StatusTone;
  enabled: boolean;
  sortOrder: number;
}

export interface StatusConfigCreateInput extends StatusConfigInput {
  entityType: StatusEntityType;
  value: string;
}

export interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export interface FieldDefinition {
  id: string;
  key: string;
  label: string;
  dataType: FieldDataType;
  unit?: string | null;
  options?: string[] | null;
  required: boolean;
  filterable: boolean;
  visibleToCustomer: boolean;
  sortable: boolean;
  displayOnCard: boolean;
  displayOnDetails: boolean;
  displayInApplication: boolean;
  isReadOnly?: boolean;
  isPrimaryMetric: boolean;
  isSecondaryMetric: boolean;
  sortOrder: number;
}

export interface FieldDefinitionInput {
  id?: string;
  key: string;
  label: string;
  dataType: FieldDataType;
  unit?: string;
  options?: string[];
  required: boolean;
  filterable: boolean;
  visibleToCustomer: boolean;
  sortable: boolean;
  displayOnCard: boolean;
  displayOnDetails: boolean;
  displayInApplication: boolean;
  isReadOnly?: boolean;
  isPrimaryMetric: boolean;
  isSecondaryMetric: boolean;
  sortOrder: number;
}

export interface ProductFieldValue {
  fieldDefinitionId: string;
  key: string;
  label: string;
  dataType: FieldDataType;
  unit?: string | null;
  value: string;
  displayOnCard: boolean;
  displayOnDetails: boolean;
  isReadOnly?: boolean;
  isPrimaryMetric: boolean;
  isSecondaryMetric: boolean;
}

export interface EmploymentType {
  id: string;
  name: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
}

export interface EmploymentTypeInput {
  name: string;
  active: boolean;
  sortOrder: number;
}

export interface RankingConfig {
  id: string;
  trendingViewWeight: number;
  trendingApplicationWeight: number;
  recommendedRatingWeight: number;
  recommendedApplicationWeight: number;
  recommendedPromotionWeight: number;
  updatedAt: string;
}

export interface RankingConfigUpdate {
  trendingViewWeight: number;
  trendingApplicationWeight: number;
  recommendedRatingWeight: number;
  recommendedApplicationWeight: number;
  recommendedPromotionWeight: number;
}

export interface ProductType {
  id: string;
  name: string;
  code: string;
  iconKey: string;
  applyButtonLabel: string;
  amountFieldLabel: string;
  shortLabel: string;
  productCount: number;
  fieldDefinitions: FieldDefinition[];
}

export interface ProductTypeInput {
  name: string;
  code: string;
  iconKey: string;
  applyButtonLabel?: string;
  amountFieldLabel?: string;
  shortLabel?: string;
}

export interface DocumentDefinition {
  id: string;
  name: string;
  documentType: string;
  required: boolean;
  sortOrder: number;
  active: boolean;
  productTypeId?: string | null;
  productTypeName?: string | null;
  createdAt: string;
}

export interface DocumentDefinitionInput {
  name: string;
  documentType: string;
  required: boolean;
  sortOrder: number;
  active: boolean;
  productTypeId?: string | null;
}

export interface Category {
  id: string;
  name: string;
  slug: string;
  description: string;
  iconKey: string;
  status: CategoryStatus;
  displayOrder: number;
  /** Products filed directly against this category. */
  productCount: number;
  /** Products against this category or any of its sub-categories - what an admin means by "linked products". */
  totalProductCount: number;
  subCategoryCount: number;
  createdAt: string;
}

export interface CategoryInput {
  name: string;
  description: string;
  iconKey: string;
  status: CategoryStatus;
  displayOrder: number;
}

export interface ProductBenefit {
  id: string;
  title: string;
  description: string;
  iconKey: string;
}

export interface ProductBenefitInput {
  title: string;
  description: string;
  iconKey: string;
}

export interface ProductEligibility {
  id: string;
  criteria: string;
  description: string;
}

export interface ProductEligibilityInput {
  criteria: string;
  description: string;
}

export interface Promotion {
  id: string;
  productId: string;
  productName: string;
  productCategoryName: string;
  title: string;
  description: string;
  badgeText: string;
  offerDetail: string;
  termsAndConditions: string;
  startDate: string;
  endDate: string;
  priority: number;
  status: PromotionStatus;
}

export interface PromotionInput {
  productId: string;
  title: string;
  description: string;
  badgeText: string;
  offerDetail: string;
  termsAndConditions: string;
  startDate: string;
  endDate: string;
  priority: number;
  status: PromotionStatus;
}

export interface Review {
  id: string;
  productId: string;
  productName: string;
  customerName: string;
  customerEmail: string;
  rating: number;
  comment: string;
  status: ReviewStatus;
  createdAt: string;
}

export interface ProductListItem {
  id: string;
  name: string;
  code: string;
  shortDescription: string;
  iconKey: string;
  status: ProductStatus;
  categoryId: string;
  categoryName: string;
  productTypeId: string;
  productTypeName: string;
  productTypeCode: string;
  productTypeShortLabel: string;
  applyButtonLabel: string;
  amountFieldLabel: string;
  ratingAverage: number;
  ratingCount: number;
  applicationCount: number;
  cardFields: ProductFieldValue[];
  featureTags: string[];
  activePromotion: Promotion | null;
  createdAt: string;
  updatedAt: string;
}

export interface ProductDetail extends ProductListItem {
  description: string;
  viewCount: number;
  detailFields: ProductFieldValue[];
  benefits: ProductBenefit[];
  eligibilityCriteria: ProductEligibility[];
  recentReviews: Review[];
  promotions: Promotion[];
}

export interface ProductFieldValueInput {
  fieldDefinitionId: string;
  value: string;
}

export interface ProductInput {
  name: string;
  code: string;
  shortDescription: string;
  description: string;
  iconKey: string;
  categoryId: string;
  productTypeId: string;
  status: ProductStatus;
  fieldValues: ProductFieldValueInput[];
  benefits: ProductBenefitInput[];
  eligibilityCriteria: ProductEligibilityInput[];
}

export interface ApplicationFieldValue {
  fieldKey: string;
  fieldLabel: string;
  value: string;
}

export interface ApplicationFieldValueInput {
  fieldDefinitionId?: string;
  fieldKey: string;
  fieldLabel: string;
  value: string;
}

export interface ApplicationDocument {
  id: string;
  documentName: string;
  documentType: string;
  required: boolean;
  uploaded: boolean;
  fileName?: string | null;
  uploadedAt?: string | null;
  contentType?: string | null;
  fileSizeBytes?: number | null;
}

export interface ApplicationStatusHistoryEntry {
  status: ApplicationStatus;
  note: string;
  changedAt: string;
}

export interface ApplicationListItem {
  id: string;
  applicationNumber: string;
  customerName: string;
  productId: string;
  productName: string;
  categoryName: string;
  status: ApplicationStatus;
  createdAt: string;
  submittedAt?: string | null;
  updatedAt: string;
}

export interface ApplicationDetail extends ApplicationListItem {
  customerEmail: string;
  customerPhone: string;
  customerDateOfBirth?: string | null;
  reviewNotes: string;
  productIconKey: string;
  fieldValues: ApplicationFieldValue[];
  documents: ApplicationDocument[];
  statusHistory: ApplicationStatusHistoryEntry[];
}

export interface ApplicationInput {
  productId: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  customerDateOfBirth: string;
  fieldValues: ApplicationFieldValueInput[];
  requiredDocuments: string[];
  submit: boolean;
}

export interface Kpi {
  label: string;
  value: number;
  changePercent: number;
  format: "number" | "percent" | "currency";
}

export interface DashboardSummary {
  totalProducts: Kpi;
  activeProducts: Kpi;
  totalApplications: Kpi;
  totalViews: Kpi;
  conversionRate: Kpi;
  rangeStart: string;
  rangeEnd: string;
}

export interface TrendPoint {
  label: string;
  date: string;
  value: number;
}

export interface CategoryBreakdown {
  categoryName: string;
  count: number;
  percentage: number;
}

export interface StatusDistribution {
  status: string;
  count: number;
  percentage: number;
}

export interface TopProduct {
  id: string;
  name: string;
  code: string;
  categoryName: string;
  iconKey: string;
  applicationCount: number;
}

export interface RecentProduct {
  id: string;
  name: string;
  categoryName: string;
  iconKey: string;
  status: ProductStatus;
  createdAt: string;
}

export interface TopSearch {
  term: string;
  count: number;
}

export interface TopPerformer {
  id: string;
  name: string;
  categoryName: string;
  iconKey: string;
  applicationCount: number;
  viewCount: number;
  ratingAverage: number;
  ratingCount: number;
}

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

/** Headline audit figures computed server-side across the full filtered result set. */
export interface AuditLogSummary {
  totalCount: number;
  successCount: number;
  failureCount: number;
  successRate: number;
  actionTypeCount: number;
  entityTypeCount: number;
}
