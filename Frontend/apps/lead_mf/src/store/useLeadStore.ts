import { create } from 'zustand';
import { LeadFormData, FormValidationErrors, NavigationPage, LeadRecord, DropdownOption, AuditRecord } from '../types/lead';
import {
  apiClient,
  isApprovalPending,
  KpiSummary,
  TimeSeriesPoint,
  ProductDistribution,
  BranchDistribution,
  DashboardFilterParams,
} from '../api/apiClient';
import { isFieldRequired, type LeadFieldConfig } from '../config/fieldControlRegistry';
import { readStoredPageSize } from '@omniremit/ui';

/** LeadFormData's field names match the backend's apiField catalog 1:1 with exactly one exception —
 * the form calls it `preferredBranch`, the catalog calls it `branch`. Central so both validateField
 * and validateForm stay in sync. */
const CATALOG_FIELD_TO_FORM_FIELD: Partial<Record<string, keyof LeadFormData>> = {
  customerName: 'customerName',
  icNumber: 'icNumber',
  phoneNumber: 'phoneNumber',
  email: 'email',
  state: 'state',
  branch: 'preferredBranch',
  employerName: 'employerName',
  appliedAmount: 'appliedAmount',
  propertyType: 'propertyType',
  propertyStatus: 'propertyStatus',
  dateOfIncorporation: 'dateOfIncorporation',
  companyName: 'companyName',
  entityType: 'entityType',
  marketingConsent: 'marketingConsent',
  agreedToPrivacyPolicy: 'agreedToPrivacyPolicy',
};

interface ToastState {
  show: boolean;
  title: string;
  message: string;
  errorsList?: string[];
  type: 'success' | 'info' | 'warning' | 'error';
  payload?: any;
}

export interface FilterRule {
  id: string;
  field: string;
  value: string;
}

interface LeadStoreState {
  // Navigation
  activePage: NavigationPage;
  setActivePage: (page: NavigationPage) => void;
  isSidebarExpanded: boolean;
  toggleSidebar: () => void;

  // Master Data Options (Dynamic from Backend API)
  products: DropdownOption[];
  states: DropdownOption[];
  branches: DropdownOption[];
  salesExecutives: DropdownOption[];
  propertyTypes: DropdownOption[];
  propertyStatuses: DropdownOption[];
  entityTypes: DropdownOption[];
  isLoadingMasterData: boolean;

  fetchMasterData: () => Promise<void>;
  fetchBranches: (stateName?: string, query?: string) => Promise<void>;
  fetchSalesExecutives: (query?: string) => Promise<void>;

  // Form State
  formData: LeadFormData;
  setFieldValue: <K extends keyof LeadFormData>(field: K, value: LeadFormData[K]) => void;
  setProduct: (product: string) => void;
  resetForm: () => void;

  // Field Settings — the selected product's config, driving which sections/fields render, their
  // label/required/editable state, and (for View/Details) masking. Keyed by product NAME -> Guid id
  // since LeadFormData.product is a name but the config API is keyed by the real Product id.
  productIdByName: Record<string, string>;
  fieldConfig: LeadFieldConfig[];
  isLoadingFieldConfig: boolean;
  fetchFieldConfigForProduct: (productName: string) => Promise<void>;

  /** The View Leads table shows leads from every product at once, so its columns can't reflect any
   * ONE product's config the way the Create/Edit forms do — they're driven by the common-field
   * subset of a single deterministic reference product's config instead (the first product returned
   * by the products endpoint). Kept separate from `fieldConfig` above so navigating Create/Edit
   * elsewhere never changes what the table displays. */
  commonFieldConfig: LeadFieldConfig[];
  fetchCommonFieldConfig: () => Promise<void>;

  // Validation
  errors: FormValidationErrors;
  validateForm: () => boolean;
  validateField: (field: keyof LeadFormData, value?: any) => void;
  clearError: (field: keyof LeadFormData) => void;

  // Lead Submission
  isSubmitting: boolean;
  submitLead: () => Promise<boolean>;

  // Toast Notifications
  toast: ToastState | null;
  showToast: (toast: Omit<ToastState, 'show'>) => void;
  hideToast: () => void;

  // Lead Directory (Dynamic from Backend API)
  leads: LeadRecord[];
  totalRecords: number;
  totalPages: number;
  currentPage: number;
  pageSize: number;
  isLoadingLeads: boolean;
  searchQuery: string;
  selectedProductFilter: string;
  selectedStateFilter: string;
  filterRules: FilterRule[];

  addFilterRule: () => void;
  removeFilterRule: (id: string) => void;
  updateFilterRule: (id: string, field: string, value: string) => void;
  /**
   * Set (or clear) the filter for one field and refetch — what a per-column table filter needs.
   * The existing rule-list actions are id-based and assume the multi-rule popover UI; a column
   * header only ever knows its own field.
   */
  setColumnFilter: (field: string, value: string) => void;
  applyFilters: () => void;
  clearAllFilters: () => void;

  setSearchQuery: (query: string) => void;
  setSelectedProductFilter: (product: string) => void;
  setSelectedStateFilter: (state: string) => void;
  setPage: (page: number) => void;
  setPageSize: (size: number) => void;
  clearFilters: () => void;
  fetchLeads: () => Promise<void>;

  // Dashboard State (Dynamic Analytics from Backend API)
  dashboardDatePreset: string;
  dashboardStartDate: string;
  dashboardEndDate: string;
  dashboardProduct: string;
  dashboardBranch: string;
  dashboardGranularity: 'daily' | 'weekly' | 'monthly';

  kpiSummary: KpiSummary;
  leadsOverTime: TimeSeriesPoint[];
  leadsByProduct: ProductDistribution[];
  leadsByBranch: BranchDistribution[];
  recentLeads: LeadRecord[];
  isLoadingDashboard: boolean;

  setDashboardDatePreset: (preset: string) => void;
  setDashboardDateRange: (startDate: string, endDate: string) => void;
  setDashboardProduct: (product: string) => void;
  setDashboardBranch: (branch: string) => void;
  setDashboardGranularity: (granularity: 'daily' | 'weekly' | 'monthly') => void;
  resetDashboardFilters: () => void;
  fetchDashboardData: () => Promise<void>;

  // Lead Drawers
  isDrawerOpen: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;

  selectedLead: LeadRecord | null;
  isDetailsDrawerOpen: boolean;
  openDetailsDrawer: (lead: LeadRecord) => void;
  closeDetailsDrawer: () => void;

  // Edit Lead State
  isEditReasonOpen: boolean;
  isEditLeadOpen: boolean;
  editLeadTarget: LeadRecord | null;
  editReason: string;
  editFormData: LeadFormData;
  editErrors: FormValidationErrors;
  isConfirmingEdit: boolean;

  openEditWorkflow: (lead: LeadRecord) => void;
  closeEditReasonDrawer: () => void;
  proceedToEditLead: (reason: string) => void;
  setEditFieldValue: <K extends keyof LeadFormData>(field: K, value: LeadFormData[K]) => void;
  validateEditForm: () => boolean;
  submitEditLead: (reason: string) => Promise<boolean>;
  closeEditLeadDrawer: () => void;
  setIsConfirmingEdit: (val: boolean) => void;

  // Delete Lead State
  isDeleteReasonOpen: boolean;
  isDeleteConfirmOpen: boolean;
  deleteLeadTarget: LeadRecord | null;
  deleteReason: string;

  openDeleteWorkflow: (lead: LeadRecord) => void;
  closeDeleteReasonDrawer: () => void;
  proceedToDeleteConfirm: (reason: string) => void;
  backToDeleteReason: () => void;
  confirmDeleteLead: () => Promise<boolean>;
  closeDeleteWorkflow: () => void;

  // Audit Logs State
  auditLogs: AuditRecord[];
  totalAuditRecords: number;
  auditPage: number;
  auditPageSize: number;
  auditSearchQuery: string;
  auditActionFilter: string;
  isLoadingAuditLogs: boolean;
  selectedAuditLog: AuditRecord | null;
  isAuditDetailsOpen: boolean;

  fetchAuditLogs: () => Promise<void>;
  openAuditDetails: (log: AuditRecord) => void;
  closeAuditDetails: () => void;
  setAuditPage: (page: number) => void;
  /** Rows per page for the audit table. The page size was fixed at 10 with no way to change it. */
  setAuditPageSize: (size: number) => void;
  setAuditSearchQuery: (query: string) => void;
  setAuditActionFilter: (action: string) => void;
}

const FIELD_DISPLAY_NAMES: Record<string, string> = {
  product: 'Product',
  customerName: 'Customer Name',
  icNumber: 'IC Number',
  phoneNumber: 'Phone Number',
  email: 'Email',
  state: 'State',
  preferredBranch: 'Preferred Servicing Branch',
  employerName: 'Employer Name',
  appliedAmount: 'Applied Amount',
  preferredSalesExecutive: 'Preferred Sales Executive',
  propertyType: 'Property Type',
  propertyStatus: 'Property Status',
  dateOfIncorporation: 'Date of Incorporation',
  companyName: 'Company Name',
  entityType: 'Entity Type',
  marketingConsent: 'Marketing Consent',
  agreedToPrivacyPolicy: 'Privacy Policy Agreement',
};

export const getEmptyErrorMessage = (field: string): string => {
  const name = FIELD_DISPLAY_NAMES[field] || field;
  return `Please enter the ${name}`;
};

export const getIncorrectErrorMessage = (field: string): string => {
  const name = FIELD_DISPLAY_NAMES[field] || field;
  return `Please enter the ${name} correctly.`;
};

const initialFormData: LeadFormData = {
  product: '',
  customerName: '',
  icNumber: '',
  phoneCountryCode: '+60',
  phoneNumber: '',
  email: '',
  state: '',
  preferredBranch: '',
  employerName: '',
  appliedAmount: '',
  hasPreferredSalesExecutive: false,
  preferredSalesExecutive: '',
  propertyType: '',
  propertyStatus: '',
  dateOfIncorporation: '',
  companyName: '',
  entityType: '',
  marketingConsent: '',
  agreedToPrivacyPolicy: false,
};

const initialKpiSummary: KpiSummary = {
  totalLeads: 0,
  newLeads: 0,
  inProgressLeads: null,
  convertedLeads: 0,
  conversionRate: null,
};

export const useLeadStore = create<LeadStoreState>((set, get) => ({
  activePage: 'dashboard',
  setActivePage: (page) => {
    set({ activePage: page });
    if (page === 'view-lead') {
      get().fetchLeads();
      void get().fetchCommonFieldConfig();
    } else if (page === 'dashboard') {
      get().fetchDashboardData();
    } else if (page === 'audit-logs') {
      get().fetchAuditLogs();
    }
  },
  isSidebarExpanded: true,
  toggleSidebar: () => set((state) => ({ isSidebarExpanded: !state.isSidebarExpanded })),

  // Field Settings
  productIdByName: {},
  fieldConfig: [],
  isLoadingFieldConfig: false,
  fetchFieldConfigForProduct: async (productName) => {
    const productId = get().productIdByName[productName];
    if (!productId) {
      set({ fieldConfig: [] });
      return;
    }
    set({ isLoadingFieldConfig: true });
    try {
      const config = await apiClient.getFieldConfig(productId);
      set({ fieldConfig: config, isLoadingFieldConfig: false });
    } catch {
      set({ fieldConfig: [], isLoadingFieldConfig: false });
    }
  },

  commonFieldConfig: [],
  fetchCommonFieldConfig: async () => {
    const productsWithId = await apiClient.getProductsWithId();
    if (productsWithId.length === 0) {
      set({ commonFieldConfig: [] });
      return;
    }
    const config = await apiClient.getFieldConfig(productsWithId[0].id);
    set({ commonFieldConfig: config });
  },

  // Master Data Options
  products: [],
  states: [],
  branches: [],
  salesExecutives: [],
  propertyTypes: [],
  propertyStatuses: [],
  entityTypes: [],
  isLoadingMasterData: false,

  fetchMasterData: async () => {
    set({ isLoadingMasterData: true });
    try {
      const [products, states, referenceData, salesExecs, productsWithId] = await Promise.all([
        apiClient.getProducts(),
        apiClient.getStates(),
        apiClient.getReferenceData(),
        apiClient.getSalesExecutives(),
        apiClient.getProductsWithId(),
      ]);

      set({
        products,
        states,
        propertyTypes: referenceData.propertyTypes,
        propertyStatuses: referenceData.propertyStatuses,
        entityTypes: referenceData.entityTypes,
        salesExecutives: salesExecs,
        productIdByName: Object.fromEntries(productsWithId.map((p) => [p.name, p.id])),
        isLoadingMasterData: false,
      });

      get().fetchBranches();
    } catch (err) {
      console.error('Failed to load master data:', err);
      set({ isLoadingMasterData: false });
    }
  },

  fetchBranches: async (stateName, query) => {
    try {
      const branches = await apiClient.getBranches(stateName, query);
      set({ branches });
    } catch (err) {
      console.error('Failed to fetch branches:', err);
      set({ branches: [] });
    }
  },

  fetchSalesExecutives: async (query) => {
    try {
      const salesExecutives = await apiClient.getSalesExecutives(query);
      set({ salesExecutives });
    } catch (err) {
      console.error('Failed to fetch sales executives:', err);
    }
  },

  // Form State
  formData: initialFormData,

  setFieldValue: (field, value) => {
    set((state) => {
      const updatedErrors = { ...state.errors };
      delete updatedErrors[field];
      const newFormData = { ...state.formData, [field]: value };

      if (field === 'state') {
        newFormData.preferredBranch = '';
        get().fetchBranches(value as string);
      }

      return {
        formData: newFormData,
        errors: updatedErrors,
      };
    });
    get().validateField(field, value);
  },

  setProduct: (product) => {
    set((state) => ({
      formData: {
        ...state.formData,
        product,
        propertyType: '',
        propertyStatus: '',
        dateOfIncorporation: '',
        companyName: '',
        entityType: '',
      },
      errors: {},
    }));
    void get().fetchFieldConfigForProduct(product);
  },

  resetForm: () => set({ formData: initialFormData, errors: {} }),

  // Validation
  errors: {},

  validateField: (field, value) => {
    set((state) => {
      const errors = { ...state.errors };
      const val = value !== undefined ? value : state.formData[field];

      const isValEmpty = val === undefined || val === null || (typeof val === 'string' && !val.trim()) || val === false;

      // Driven by Field Settings' per-product Required flag. A field absent from the currently
      // loaded config — either not applicable to this product (e.g. propertyType for a non-Home
      // Financing product) or not loaded yet — is never treated as required here: the corresponding
      // input isn't rendered in either case (LeadFormContainer gates on the same config), so requiring
      // an unrenderable field would block submission with no way to satisfy it.
      const requiredFields: (keyof LeadFormData)[] = ['product'];
      for (const [apiField, formField] of Object.entries(CATALOG_FIELD_TO_FORM_FIELD)) {
        if (formField && isFieldRequired(state.fieldConfig, apiField)) requiredFields.push(formField);
      }
      // hasPreferredSalesExecutive/preferredSalesExecutive's "if checked, the dropdown becomes
      // mandatory" pairing stays its own hardcoded rule, independent of Field Settings — see
      // LeadFieldConfigService's own doc comment for why.
      if (state.formData.hasPreferredSalesExecutive) requiredFields.push('preferredSalesExecutive');

      if (isValEmpty && requiredFields.includes(field)) {
        errors[field] = getEmptyErrorMessage(field as string);
        return { errors };
      }

      switch (field) {
        case 'icNumber':
          if (val && typeof val === 'string' && val.trim()) {
            if (!/^\d{6}-\d{2}-\d{4}$/.test(val.trim())) {
              errors.icNumber = getIncorrectErrorMessage('icNumber');
            } else {
              delete errors.icNumber;
            }
          }
          break;
        case 'phoneNumber':
          if (val && typeof val === 'string' && val.trim()) {
            const fullPhone = `${state.formData.phoneCountryCode}${val.trim().replace(/\s|-/g, '')}`;
            if (!/^\+60[1-9]\d{7,9}$/.test(fullPhone)) {
              errors.phoneNumber = getIncorrectErrorMessage('phoneNumber');
            } else {
              delete errors.phoneNumber;
            }
          }
          break;
        case 'email':
          if (val && typeof val === 'string' && val.trim()) {
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(val.trim())) {
              errors.email = getIncorrectErrorMessage('email');
            } else {
              delete errors.email;
            }
          }
          break;
        default:
          if (val && typeof val === 'string' && val.trim()) {
            delete errors[field];
          }
          break;
      }

      return { errors };
    });
  },

  clearError: (field) => {
    set((state) => {
      const updatedErrors = { ...state.errors };
      delete updatedErrors[field];
      return { errors: updatedErrors };
    });
  },

  validateForm: () => {
    const { formData } = get();
    const errors: FormValidationErrors = {};

    if (!formData.product) {
      errors.product = getEmptyErrorMessage('product');
    }

    // Field Settings' per-product Required flag drives presence; format checks (regex/email shape)
    // stay unconditional once a value IS present — mirrors the backend's exact split of concerns
    // (LeadFieldConfigService.EnsureRequiredFieldsPresent vs. CreateLeadDto's format validators).
    const { fieldConfig } = get();

    if (isFieldRequired(fieldConfig, 'customerName') && !formData.customerName.trim()) {
      errors.customerName = getEmptyErrorMessage('customerName');
    }

    if (isFieldRequired(fieldConfig, 'icNumber') && !formData.icNumber.trim()) {
      errors.icNumber = getEmptyErrorMessage('icNumber');
    } else if (formData.icNumber.trim() && !/^\d{6}-\d{2}-\d{4}$/.test(formData.icNumber.trim())) {
      errors.icNumber = getIncorrectErrorMessage('icNumber');
    }

    if (isFieldRequired(fieldConfig, 'phoneNumber') && !formData.phoneNumber.trim()) {
      errors.phoneNumber = getEmptyErrorMessage('phoneNumber');
    } else if (formData.phoneNumber.trim()) {
      const fullPhone = `${formData.phoneCountryCode}${formData.phoneNumber.trim().replace(/\s|-/g, '')}`;
      if (!/^\+60[1-9]\d{7,9}$/.test(fullPhone)) {
        errors.phoneNumber = getIncorrectErrorMessage('phoneNumber');
      }
    }

    if (isFieldRequired(fieldConfig, 'email') && !formData.email.trim()) {
      errors.email = getEmptyErrorMessage('email');
    } else if (formData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(formData.email.trim())) {
      errors.email = getIncorrectErrorMessage('email');
    }

    if (isFieldRequired(fieldConfig, 'state') && !formData.state) {
      errors.state = getEmptyErrorMessage('state');
    }

    if (isFieldRequired(fieldConfig, 'employerName') && !formData.employerName.trim()) {
      errors.employerName = getEmptyErrorMessage('employerName');
    }

    if (isFieldRequired(fieldConfig, 'appliedAmount') && !formData.appliedAmount.trim()) {
      errors.appliedAmount = getEmptyErrorMessage('appliedAmount');
    }

    if (formData.hasPreferredSalesExecutive && !formData.preferredSalesExecutive.trim()) {
      errors.preferredSalesExecutive = getEmptyErrorMessage('preferredSalesExecutive');
    }

    if (fieldConfig.some((f) => f.apiField === 'propertyType')) {
      if (isFieldRequired(fieldConfig, 'propertyType') && !formData.propertyType) {
        errors.propertyType = getEmptyErrorMessage('propertyType');
      }
      if (isFieldRequired(fieldConfig, 'propertyStatus') && !formData.propertyStatus) {
        errors.propertyStatus = getEmptyErrorMessage('propertyStatus');
      }
    }

    if (fieldConfig.some((f) => f.apiField === 'dateOfIncorporation')) {
      if (isFieldRequired(fieldConfig, 'dateOfIncorporation') && !formData.dateOfIncorporation) {
        errors.dateOfIncorporation = getEmptyErrorMessage('dateOfIncorporation');
      }
      if (isFieldRequired(fieldConfig, 'companyName') && !formData.companyName.trim()) {
        errors.companyName = getEmptyErrorMessage('companyName');
      }
      if (isFieldRequired(fieldConfig, 'entityType') && !formData.entityType) {
        errors.entityType = getEmptyErrorMessage('entityType');
      }
    }

    if (isFieldRequired(fieldConfig, 'marketingConsent') && !formData.marketingConsent) {
      errors.marketingConsent = getEmptyErrorMessage('marketingConsent');
    }

    if (isFieldRequired(fieldConfig, 'agreedToPrivacyPolicy') && !formData.agreedToPrivacyPolicy) {
      errors.agreedToPrivacyPolicy = getEmptyErrorMessage('agreedToPrivacyPolicy');
    }

    set({ errors });

    const isValid = Object.keys(errors).length === 0;
    if (!isValid) {
      const errorList = Object.values(errors).filter(Boolean) as string[];
      get().showToast({
        type: 'error',
        title: 'Please correct the following errors:',
        message: '',
        errorsList: errorList,
      });
    }

    return isValid;
  },

  // Submit Lead
  isSubmitting: false,
  submitLead: async () => {
    const isValid = get().validateForm();
    if (!isValid) return false;

    set({ isSubmitting: true });
    try {
      const response = await apiClient.createLead(get().formData);
      set({ isSubmitting: false });

      if (response.success) {
        if (isApprovalPending(response.data)) {
          // Nothing was actually created — the "Lead" module has a checker assigned, so this
          // submission is queued instead of applied. No list/dashboard refresh: nothing changed yet.
          get().showToast({
            type: 'info',
            title: 'Submitted for Approval',
            message: response.data.message || 'This lead requires approval before it is created.',
          });
          get().resetForm();
          return true;
        }
        get().showToast({
          type: 'success',
          title: 'Success',
          message: 'Lead submitted successfully',
        });
        get().resetForm();
        get().fetchLeads();
        get().fetchDashboardData();
        return true;
      } else {
        get().showToast({
          type: 'error',
          title: 'Submission Failed',
          message: response.message || 'Failed to submit lead.',
        });
        if (response.errors) {
          set({ errors: response.errors as FormValidationErrors });
        }
        return false;
      }
    } catch (err: any) {
      set({ isSubmitting: false });
      get().showToast({
        type: 'error',
        title: 'System Error',
        message: err?.message || 'Could not connect to backend server.',
      });
      return false;
    }
  },

  // Toast Notifications
  toast: null,
  showToast: (toast) => set({ toast: { ...toast, show: true } }),
  hideToast: () => set({ toast: null }),

  // Lead Directory
  leads: [],
  totalRecords: 0,
  totalPages: 1,
  currentPage: 1,
  pageSize: readStoredPageSize('lead.directory', 10),
  isLoadingLeads: false,
  searchQuery: '',
  selectedProductFilter: '',
  selectedStateFilter: '',
  filterRules: [{ id: '1', field: 'product', value: '' }],

  addFilterRule: () => {
    set((state) => ({
      filterRules: [
        ...state.filterRules,
        { id: Date.now().toString(), field: 'salesExecutive', value: '' },
      ],
    }));
  },

  removeFilterRule: (id) => {
    set((state) => {
      const updated = state.filterRules.filter((r) => r.id !== id);
      return { filterRules: updated.length > 0 ? updated : [{ id: Date.now().toString(), field: 'product', value: '' }] };
    });
  },

  updateFilterRule: (id, field, value) => {
    set((state) => ({
      filterRules: state.filterRules.map((r) =>
        r.id === id ? { ...r, field, value } : r
      ),
    }));
  },

  setColumnFilter: (field, value) => {
    set((state) => {
      const existing = state.filterRules.find((r) => r.field === field);
      let filterRules;
      if (existing) {
        filterRules = state.filterRules.map((r) => (r.field === field ? { ...r, value } : r));
      } else if (value) {
        filterRules = [...state.filterRules, { id: `col-${field}`, field, value }];
      } else {
        filterRules = state.filterRules;
      }
      // Keep at least one (empty) rule so the existing multi-rule popover still has a row to render.
      if (filterRules.length === 0) filterRules = [{ id: '1', field: 'product', value: '' }];
      return { filterRules, currentPage: 1 };
    });
    get().fetchLeads();
  },

  applyFilters: () => {
    set({ currentPage: 1 });
    get().fetchLeads();
  },

  clearAllFilters: () => {
    set({
      searchQuery: '',
      selectedProductFilter: '',
      selectedStateFilter: '',
      filterRules: [{ id: '1', field: 'product', value: '' }],
      currentPage: 1,
    });
    get().fetchLeads();
  },

  setSearchQuery: (query) => {
    set({ searchQuery: query, currentPage: 1 });
    get().fetchLeads();
  },

  setSelectedProductFilter: (product) => {
    set({ selectedProductFilter: product, currentPage: 1 });
    get().fetchLeads();
  },

  setSelectedStateFilter: (stateFilter) => {
    set({ selectedStateFilter: stateFilter, currentPage: 1 });
    get().fetchLeads();
  },

  setPage: (page) => {
    set({ currentPage: page });
    get().fetchLeads();
  },

  setPageSize: (size) => {
    set({ pageSize: size, currentPage: 1 });
    get().fetchLeads();
  },

  clearFilters: () => {
    get().clearAllFilters();
  },

  fetchLeads: async () => {
    set({ isLoadingLeads: true });
    try {
      const state = get();

      let product = state.selectedProductFilter;
      let branch = '';
      let stateFilter = state.selectedStateFilter;
      let salesExecutive = '';
      let month = '';
      let createdDate = '';
      let createdFrom = '';
      let createdTo = '';
      let name = '';
      let icNumber = '';
      let phone = '';
      let status = '';

      state.filterRules.forEach((rule) => {
        if (!rule.value || !rule.value.trim()) return;
        switch (rule.field) {
          case 'product':
            product = rule.value;
            break;
          case 'branch':
            branch = rule.value;
            break;
          case 'state':
            stateFilter = rule.value;
            break;
          case 'salesExecutive':
            salesExecutive = rule.value;
            break;
          case 'month':
            month = rule.value;
            break;
          case 'createdDate':
            createdDate = rule.value;
            break;
          case 'createdFrom':
            createdFrom = rule.value;
            break;
          case 'createdTo':
            createdTo = rule.value;
            break;
          case 'name':
            name = rule.value;
            break;
          case 'icNumber':
            icNumber = rule.value;
            break;
          case 'phone':
            phone = rule.value;
            break;
          case 'status':
            status = rule.value;
            break;
        }
      });

      const pagedResult = await apiClient.getLeads({
        page: state.currentPage,
        pageSize: state.pageSize,
        search: state.searchQuery,
        product,
        branch,
        state: stateFilter,
        salesExecutive,
        month,
        createdDate,
        createdFrom,
        createdTo,
        name,
        icNumber,
        phone,
        status,
      });

      set({
        leads: pagedResult.items,
        totalRecords: pagedResult.totalRecords,
        totalPages: pagedResult.totalPages,
        currentPage: pagedResult.page,
        isLoadingLeads: false,
      });
    } catch (err) {
      console.error('Failed to fetch leads:', err);
      set({ leads: [], totalRecords: 0, totalPages: 1, isLoadingLeads: false });
    }
  },

  // Dashboard Analytics State
  dashboardDatePreset: 'all',
  dashboardStartDate: '',
  dashboardEndDate: '',
  dashboardProduct: '',
  dashboardBranch: '',
  dashboardGranularity: 'daily',

  kpiSummary: initialKpiSummary,
  leadsOverTime: [],
  leadsByProduct: [],
  leadsByBranch: [],
  recentLeads: [],
  isLoadingDashboard: false,

  setDashboardDatePreset: (preset) => {
    let startDate = '';
    let endDate = '';
    const now = new Date();

    const formatDate = (d: Date) => {
      const year = d.getFullYear();
      const month = String(d.getMonth() + 1).padStart(2, '0');
      const day = String(d.getDate()).padStart(2, '0');
      return `${year}-${month}-${day}`;
    };

    if (preset === 'today') {
      startDate = formatDate(now);
      endDate = formatDate(now);
    } else if (preset === 'this_week') {
      const dayOfWeek = now.getDay();
      const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const monday = new Date(now);
      monday.setDate(now.getDate() + diffToMonday);
      startDate = formatDate(monday);
      endDate = formatDate(now);
    } else if (preset === 'last_week') {
      const dayOfWeek = now.getDay();
      const diffToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
      const lastMonday = new Date(now);
      lastMonday.setDate(now.getDate() + diffToMonday - 7);
      const lastSunday = new Date(lastMonday);
      lastSunday.setDate(lastMonday.getDate() + 6);
      startDate = formatDate(lastMonday);
      endDate = formatDate(lastSunday);
    } else if (preset === 'this_month') {
      const firstDay = new Date(now.getFullYear(), now.getMonth(), 1);
      startDate = formatDate(firstDay);
      endDate = formatDate(now);
    } else if (preset === 'last_month') {
      const firstDayLastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      const lastDayLastMonth = new Date(now.getFullYear(), now.getMonth(), 0);
      startDate = formatDate(firstDayLastMonth);
      endDate = formatDate(lastDayLastMonth);
    } else if (preset === 'this_quarter') {
      const currentQuarter = Math.floor(now.getMonth() / 3);
      const firstDayQuarter = new Date(now.getFullYear(), currentQuarter * 3, 1);
      startDate = formatDate(firstDayQuarter);
      endDate = formatDate(now);
    } else if (preset === 'this_year') {
      const jan1 = new Date(now.getFullYear(), 0, 1);
      startDate = formatDate(jan1);
      endDate = formatDate(now);
    } else if (preset === 'all_time') {
      startDate = '';
      endDate = '';
    }

    set({
      dashboardDatePreset: preset,
      dashboardStartDate: startDate,
      dashboardEndDate: endDate,
    });
    get().fetchDashboardData();
  },

  setDashboardDateRange: (startDate, endDate) => {
    set({
      dashboardDatePreset: 'custom',
      dashboardStartDate: startDate,
      dashboardEndDate: endDate,
    });
    get().fetchDashboardData();
  },

  setDashboardProduct: (product) => {
    set({ dashboardProduct: product });
    get().fetchDashboardData();
  },

  setDashboardBranch: (branch) => {
    set({ dashboardBranch: branch });
    get().fetchDashboardData();
  },

  setDashboardGranularity: (granularity) => {
    set({ dashboardGranularity: granularity });
    get().fetchDashboardData();
  },

  resetDashboardFilters: () => {
    set({
      dashboardDatePreset: 'all',
      dashboardStartDate: '',
      dashboardEndDate: '',
      dashboardProduct: '',
      dashboardBranch: '',
      dashboardGranularity: 'daily',
    });
    get().fetchDashboardData();
  },

  fetchDashboardData: async () => {
    set({ isLoadingDashboard: true });
    try {
      const s = get();
      const params: DashboardFilterParams = {
        startDate: s.dashboardStartDate || undefined,
        endDate: s.dashboardEndDate || undefined,
        product: s.dashboardProduct || undefined,
        branch: s.dashboardBranch || undefined,
        granularity: s.dashboardGranularity,
      };

      const [kpiSummary, leadsOverTime, leadsByProduct, leadsByBranch, recentLeads] =
        await Promise.all([
          apiClient.getDashboardKpis(params),
          apiClient.getLeadsOverTime(params),
          apiClient.getLeadsByProduct(params),
          apiClient.getLeadsByBranch(params),
          apiClient.getRecentLeads(params, 5),
        ]);

      set({
        kpiSummary,
        leadsOverTime,
        leadsByProduct,
        leadsByBranch,
        recentLeads,
        isLoadingDashboard: false,
      });
    } catch (err) {
      console.error('Failed to fetch dashboard analytics:', err);
      set({
        kpiSummary: initialKpiSummary,
        leadsOverTime: [],
        leadsByProduct: [],
        leadsByBranch: [],
        recentLeads: [],
        isLoadingDashboard: false,
      });
    }
  },

  // Create Lead Drawer
  isDrawerOpen: false,
  openDrawer: () => set({ isDrawerOpen: true }),
  closeDrawer: () => set({ isDrawerOpen: false }),

  // Lead Details Drawer
  selectedLead: null,
  isDetailsDrawerOpen: false,
  openDetailsDrawer: (lead) => {
    set({ selectedLead: lead, isDetailsDrawerOpen: true });
    if (lead?.id) {
      apiClient.logLeadView(lead.id);
    }
    if (lead?.product) {
      void get().fetchFieldConfigForProduct(lead.product);
    }
  },
  closeDetailsDrawer: () => set({ selectedLead: null, isDetailsDrawerOpen: false }),

  // Edit Lead Workflow State
  isEditReasonOpen: false,
  isEditLeadOpen: false,
  editLeadTarget: null,
  editReason: '',
  editFormData: initialFormData,
  editErrors: {},
  isConfirmingEdit: false,

  openEditWorkflow: (lead) => {
    // Populate form data from lead
    const phoneNo = lead.phone ? lead.phone.replace(/^\+60\s?/, '') : '';
    set({
      editLeadTarget: lead,
      isEditReasonOpen: true,
      editReason: '',
      isConfirmingEdit: false,
      editErrors: {},
      editFormData: {
        product: lead.product || '',
        customerName: lead.name || '',
        icNumber: lead.icNumber || '',
        phoneCountryCode: '+60',
        phoneNumber: phoneNo,
        email: lead.email || '',
        state: lead.state || '',
        preferredBranch: lead.branch && lead.branch !== 'Not Assigned' ? lead.branch : '',
        employerName: lead.employerName || '',
        appliedAmount: lead.appliedAmount || '',
        hasPreferredSalesExecutive: !!lead.preferredSalesExecutive,
        preferredSalesExecutive: lead.preferredSalesExecutive || '',
        propertyType: lead.propertyType || '',
        propertyStatus: lead.propertyStatus || '',
        dateOfIncorporation: lead.dateOfIncorporation || '',
        companyName: lead.companyName || '',
        entityType: lead.entityType || '',
        marketingConsent: (lead.marketingConsent as any) || 'CONSENT',
        agreedToPrivacyPolicy: true,
      },
    });
    if (lead.product) {
      void get().fetchFieldConfigForProduct(lead.product);
    }
  },

  closeEditReasonDrawer: () => set({ isEditReasonOpen: false, editLeadTarget: null, editReason: '' }),

  proceedToEditLead: (reason) => {
    set({ editReason: reason, isEditLeadOpen: true, isEditReasonOpen: false });
  },

  setEditFieldValue: (field, value) => {
    set((state) => {
      const newErrors = { ...state.editErrors };
      delete newErrors[field];
      const newForm = { ...state.editFormData, [field]: value };
      if (field === 'state') {
        newForm.preferredBranch = '';
        get().fetchBranches(value as string);
      }
      if (field === 'product') {
        newForm.propertyType = '';
        newForm.propertyStatus = '';
        newForm.dateOfIncorporation = '';
        newForm.companyName = '';
        newForm.entityType = '';
        void get().fetchFieldConfigForProduct(value as string);
      }
      return { editFormData: newForm, editErrors: newErrors };
    });
  },

  validateEditForm: () => {
    const { editFormData } = get();
    const errors: FormValidationErrors = {};

    // Field Settings' per-product Required flag — see validateForm's identical comment.
    const { fieldConfig } = get();

    if (!editFormData.product) errors.product = getEmptyErrorMessage('product');
    if (isFieldRequired(fieldConfig, 'customerName') && !editFormData.customerName.trim()) errors.customerName = getEmptyErrorMessage('customerName');
    if (isFieldRequired(fieldConfig, 'icNumber') && !editFormData.icNumber.trim()) errors.icNumber = getEmptyErrorMessage('icNumber');
    else if (editFormData.icNumber.trim() && !/^\d{6}-\d{2}-\d{4}$/.test(editFormData.icNumber.trim())) errors.icNumber = getIncorrectErrorMessage('icNumber');

    if (isFieldRequired(fieldConfig, 'phoneNumber') && !editFormData.phoneNumber.trim()) errors.phoneNumber = getEmptyErrorMessage('phoneNumber');
    else if (editFormData.phoneNumber.trim()) {
      const fullPhone = `${editFormData.phoneCountryCode}${editFormData.phoneNumber.trim().replace(/\s|-/g, '')}`;
      if (!/^\+60[1-9]\d{7,9}$/.test(fullPhone)) errors.phoneNumber = getIncorrectErrorMessage('phoneNumber');
    }

    if (isFieldRequired(fieldConfig, 'email') && !editFormData.email.trim()) errors.email = getEmptyErrorMessage('email');
    else if (editFormData.email.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(editFormData.email.trim())) errors.email = getIncorrectErrorMessage('email');

    if (isFieldRequired(fieldConfig, 'state') && !editFormData.state) errors.state = getEmptyErrorMessage('state');
    if (isFieldRequired(fieldConfig, 'employerName') && !editFormData.employerName.trim()) errors.employerName = getEmptyErrorMessage('employerName');
    if (isFieldRequired(fieldConfig, 'appliedAmount') && !editFormData.appliedAmount.trim()) errors.appliedAmount = getEmptyErrorMessage('appliedAmount');

    if (editFormData.hasPreferredSalesExecutive && !editFormData.preferredSalesExecutive.trim()) {
      errors.preferredSalesExecutive = getEmptyErrorMessage('preferredSalesExecutive');
    }

    if (fieldConfig.some((f) => f.apiField === 'propertyType')) {
      if (isFieldRequired(fieldConfig, 'propertyType') && !editFormData.propertyType) errors.propertyType = getEmptyErrorMessage('propertyType');
      if (isFieldRequired(fieldConfig, 'propertyStatus') && !editFormData.propertyStatus) errors.propertyStatus = getEmptyErrorMessage('propertyStatus');
    } else if (fieldConfig.some((f) => f.apiField === 'dateOfIncorporation')) {
      if (isFieldRequired(fieldConfig, 'dateOfIncorporation') && !editFormData.dateOfIncorporation) errors.dateOfIncorporation = getEmptyErrorMessage('dateOfIncorporation');
      if (isFieldRequired(fieldConfig, 'companyName') && !editFormData.companyName.trim()) errors.companyName = getEmptyErrorMessage('companyName');
      if (isFieldRequired(fieldConfig, 'entityType') && !editFormData.entityType) errors.entityType = getEmptyErrorMessage('entityType');
    }

    if (isFieldRequired(fieldConfig, 'marketingConsent') && !editFormData.marketingConsent) errors.marketingConsent = getEmptyErrorMessage('marketingConsent');

    set({ editErrors: errors });
    const isValid = Object.keys(errors).length === 0;
    if (!isValid) {
      const errList = Object.values(errors).filter(Boolean) as string[];
      get().showToast({
        type: 'error',
        title: 'Please correct the following errors:',
        message: '',
        errorsList: errList,
      });
    }
    return isValid;
  },

  submitEditLead: async (reason) => {
    const { editLeadTarget, editFormData } = get();
    if (!editLeadTarget) return false;

    set({ isSubmitting: true });
    try {
      const updatePayload = {
        ...editFormData,
        editReason: reason,
      };

      const res = await apiClient.updateLead(editLeadTarget.id, updatePayload);
      set({ isSubmitting: false });

      if (res.success) {
        const closeState = {
          isEditLeadOpen: false,
          isEditReasonOpen: false,
          isConfirmingEdit: false,
          editLeadTarget: null,
          editReason: '',
        };

        if (isApprovalPending(res.data)) {
          // Nothing was actually changed yet — no list/dashboard refresh.
          get().showToast({
            type: 'info',
            title: 'Submitted for Approval',
            message: res.data.message || 'This change requires approval before it is applied.',
          });
          set(closeState);
          return true;
        }

        get().showToast({
          type: 'success',
          title: 'Success',
          message: 'Changes saved successfully',
        });
        set(closeState);
        get().fetchLeads();
        get().fetchDashboardData();
        return true;
      } else {
        get().showToast({
          type: 'error',
          title: 'Update Failed',
          message: res.message || 'Failed to update lead.',
        });
        return false;
      }
    } catch (err: any) {
      set({ isSubmitting: false });
      get().showToast({
        type: 'error',
        title: 'System Error',
        message: err?.message || 'Failed to update lead.',
      });
      return false;
    }
  },

  closeEditLeadDrawer: () => set({ isEditLeadOpen: false, isEditReasonOpen: false, isConfirmingEdit: false, editLeadTarget: null, editReason: '' }),
  setIsConfirmingEdit: (val) => set({ isConfirmingEdit: val }),

  // Delete Lead Workflow State
  isDeleteReasonOpen: false,
  isDeleteConfirmOpen: false,
  deleteLeadTarget: null,
  deleteReason: '',

  openDeleteWorkflow: (lead) => {
    set({
      deleteLeadTarget: lead,
      isDeleteReasonOpen: true,
      deleteReason: '',
      isDeleteConfirmOpen: false,
    });
  },

  closeDeleteReasonDrawer: () => set({ isDeleteReasonOpen: false, deleteLeadTarget: null, deleteReason: '' }),

  proceedToDeleteConfirm: (reason) => {
    set({ deleteReason: reason, isDeleteConfirmOpen: true });
  },

  backToDeleteReason: () => set({ isDeleteConfirmOpen: false }),

  confirmDeleteLead: async () => {
    const { deleteLeadTarget, deleteReason } = get();
    if (!deleteLeadTarget) return false;

    set({ isSubmitting: true });
    try {
      const res = await apiClient.deleteLead(deleteLeadTarget.id, deleteReason);
      set({ isSubmitting: false });

      if (res.success) {
        const closeState = {
          isDeleteConfirmOpen: false,
          isDeleteReasonOpen: false,
          deleteLeadTarget: null,
          deleteReason: '',
        };

        if (isApprovalPending(res.data)) {
          // Nothing was actually deleted yet — no list/dashboard refresh.
          get().showToast({
            type: 'info',
            title: 'Submitted for Approval',
            message: res.data.message || 'This deletion requires approval before it is applied.',
          });
          set(closeState);
          return true;
        }

        get().showToast({
          type: 'success',
          title: 'Deleted',
          message: 'This lead has been deleted',
        });
        set(closeState);
        get().fetchLeads();
        get().fetchDashboardData();
        return true;
      } else {
        get().showToast({
          type: 'error',
          title: 'Delete Failed',
          message: res.message || 'Failed to delete lead.',
        });
        return false;
      }
    } catch (err: any) {
      set({ isSubmitting: false });
      get().showToast({
        type: 'error',
        title: 'System Error',
        message: err?.message || 'Failed to delete lead.',
      });
      return false;
    }
  },

  closeDeleteWorkflow: () => set({ isDeleteConfirmOpen: false, isDeleteReasonOpen: false, deleteLeadTarget: null, deleteReason: '' }),

  // Audit Logs State
  auditLogs: [],
  totalAuditRecords: 0,
  auditPage: 1,
  auditPageSize: readStoredPageSize('lead.audit', 10),
  auditSearchQuery: '',
  auditActionFilter: '',
  isLoadingAuditLogs: false,
  selectedAuditLog: null,
  isAuditDetailsOpen: false,

  fetchAuditLogs: async () => {
    set({ isLoadingAuditLogs: true });
    try {
      const state = get();
      const pagedResult = await apiClient.getAuditLogs({
        page: state.auditPage,
        pageSize: state.auditPageSize,
        search: state.auditSearchQuery,
        actionType: state.auditActionFilter,
      });

      set({
        auditLogs: pagedResult.items,
        totalAuditRecords: pagedResult.totalRecords,
        isLoadingAuditLogs: false,
      });
    } catch (err) {
      console.error('Failed to fetch audit logs:', err);
      set({ auditLogs: [], totalAuditRecords: 0, isLoadingAuditLogs: false });
    }
  },

  openAuditDetails: (log) => set({ selectedAuditLog: log, isAuditDetailsOpen: true }),
  closeAuditDetails: () => set({ selectedAuditLog: null, isAuditDetailsOpen: false }),

  setAuditPage: (page) => {
    set({ auditPage: page });
    get().fetchAuditLogs();
  },

  setAuditPageSize: (size) => {
    set({ auditPageSize: size, auditPage: 1 });
    get().fetchAuditLogs();
  },

  setAuditSearchQuery: (query) => {
    set({ auditSearchQuery: query, auditPage: 1 });
    get().fetchAuditLogs();
  },

  setAuditActionFilter: (action) => {
    set({ auditActionFilter: action, auditPage: 1 });
    get().fetchAuditLogs();
  },
}));
