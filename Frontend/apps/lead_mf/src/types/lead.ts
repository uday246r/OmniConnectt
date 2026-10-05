export type ProductType = string;
export type MalaysianState = string;
export type PropertyType = string;
export type PropertyStatus = string;
export type EntityType = string;
export type MarketingConsent = 'CONSENT' | 'DO_NOT_CONSENT' | '';

export interface LeadFormData {
  // Product Selection — chosen from the Marketplace's catalogue (Category → Product). The id is what is
  // sent; the name and sub-category are for showing it and for finding this lead's field settings.
  product: string;
  catalogProductId: string;
  /** The sub-category the product sits under: one lead form per sub-category. Never sent (the server reads it from the Marketplace). */
  subCategoryId: string;

  // Customer Information (Common)
  customerName: string;
  icNumber: string;
  phoneCountryCode: string;
  phoneNumber: string;
  email: string;
  state: string;
  preferredBranch: string;
  employerName: string;
  appliedAmount: string;

  // Preferred Sales Executive
  hasPreferredSalesExecutive: boolean;
  preferredSalesExecutive: string;

  // Home Financing Specific
  propertyType: string;
  propertyStatus: string;

  // Microfinance Specific
  dateOfIncorporation: string; // DD/MM/YYYY
  companyName: string;
  entityType: string;

  // Declaration & Consent
  marketingConsent: MarketingConsent;
  agreedToPrivacyPolicy: boolean;
}

/** A product picked from the catalogue: what the form needs to keep about it. */
export interface SelectedProduct {
  id: string;
  name: string;
  subCategoryId: string;
}

export type FormValidationErrors = Partial<Record<keyof LeadFormData, string>>;

export interface DropdownOption {
  value: string;
  label: string;
  badge?: string;
  description?: string;
}

export type NavigationPage = 'dashboard' | 'create-lead' | 'view-lead' | 'audit-logs' | 'field-settings';

export type LeadStatus = 'New' | 'Contacted' | 'In Progress' | 'Qualified' | 'Converted' | 'Closed' | string;

export interface LeadRecord {
  id: string;
  name: string;
  icNumber: string;
  phone: string;
  email: string;
  product: string;
  catalogProductId?: string | null;
  categoryName?: string;
  subCategoryId?: string | null;
  subCategoryName?: string;
  state: string;
  branch: string;
  status: LeadStatus;
  createdDate: string;
  employerName?: string;
  appliedAmount?: string;
  preferredSalesExecutive?: string;
  propertyType?: string;
  propertyStatus?: string;
  dateOfIncorporation?: string;
  companyName?: string;
  entityType?: string;
  marketingConsent?: string;
}

export type FilterCriterion =
  | 'product'
  | 'branch'
  | 'createdFrom'
  | 'createdTo'
  | 'icNumber'
  | 'phone'
  | 'name'
  | 'status'
  | 'salesExecutive'
  | 'month'
  | 'createdDate'
  | 'state';

export interface FilterRule {
  id: string;
  field: FilterCriterion;
  value: string;
}

export interface AuditRecord {
  id: string;
  timestamp: string;
  userId: string;
  userName: string;
  userRole: string;
  actionType: string;
  entityType: string;
  entityId: string;
  description: string;
  reason?: string;
  previousValues?: string;
  newValues?: string;
  ipAddress: string;
  status: string;
}

export interface FieldDiff {
  field: string;
  previousValue: string;
  newValue: string;
}
