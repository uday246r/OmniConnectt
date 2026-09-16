import { getAccessToken, ensureFreshAccessToken, isRunningInHost } from './hostBridge';
import type { LeadFieldConfig } from '../config/fieldControlRegistry';
import type { CustomPreset } from '@omniconnect/ui/validation';

export const API_BASE_URL = (import.meta as any).env?.VITE_API_BASE_URL || 'http://localhost:5046/api/lead-service';

export interface ApiResponse<T> {
  success: boolean;
  data: T;
  message?: string | null;
  errors?: Record<string, string> | null;
}

/**
 * Returned in `data` (with `success: true`, HTTP 202) instead of the real record whenever a mutation
 * was gated by Maker-Checker approval and could not be applied directly — the "Lead" module has a
 * checker assigned. Mirrors AuthService's own ApprovalPendingDto shape; Module Federation isolation
 * means this can't be imported from the host, so it's a local structural copy — `isApprovalPending`
 * checks by shape (`approvalRequestId` present), not by class.
 */
export interface ApprovalPendingDto {
  approvalRequestId: string;
  module: string;
  action: string;
  checkerName: string;
  message: string;
}

export function isApprovalPending(value: unknown): value is ApprovalPendingDto {
  return typeof value === 'object' && value !== null && 'approvalRequestId' in value;
}

export interface DropdownOption {
  value: string;
  label: string;
  description?: string;
}

export interface ReferenceData {
  propertyTypes: DropdownOption[];
  propertyStatuses: DropdownOption[];
  entityTypes: DropdownOption[];
}

export interface LeadRecord {
  id: string;
  name: string;
  icNumber: string;
  phone: string;
  email: string;
  product: string;
  state: string;
  branch: string;
  status: string;
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

export interface PagedResult<T> {
  items: T[];
  totalRecords: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DashboardFilterParams {
  startDate?: string;
  endDate?: string;
  product?: string;
  branch?: string;
  granularity?: 'daily' | 'weekly' | 'monthly';
}

export interface KpiSparklinePoint {
  date: string;
  value: number;
}

export interface KpiSummary {
  totalLeads: number;
  newLeads: number;
  inProgressLeads: number | null;
  convertedLeads: number;
  conversionRate: number | null;
  totalLeadsTrend?: KpiSparklinePoint[];
  newLeadsTrend?: KpiSparklinePoint[];
  inProgressLeadsTrend?: KpiSparklinePoint[];
  convertedLeadsTrend?: KpiSparklinePoint[];
  conversionRateTrend?: KpiSparklinePoint[];
}

export interface TimeSeriesPoint {
  label: string;
  date: string;
  count: number;
}

export interface ProductDistribution {
  productName: string;
  count: number;
  percentage: number;
  color: string;
}

export interface BranchDistribution {
  branchName: string;
  count: number;
}

export interface TopSalesExecutive {
  rank: number;
  name: string;
  convertedLeads: number;
  conversionRate: number;
}

function buildDashboardQuery(params?: DashboardFilterParams): string {
  if (!params) return '';
  const query = new URLSearchParams();
  if (params.startDate) query.append('startDate', params.startDate);
  if (params.endDate) query.append('endDate', params.endDate);
  if (params.product) query.append('product', params.product);
  if (params.branch) query.append('branch', params.branch);
  if (params.granularity) query.append('granularity', params.granularity);
  const qStr = query.toString();
  return qStr ? `?${qStr}` : '';
}

/** Helper to get current Authorization header */
async function getAuthHeaders(): Promise<Record<string, string>> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };

  if (isRunningInHost()) {
    try {
      const token = await ensureFreshAccessToken();
      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }
    } catch {
      const fallbackToken = getAccessToken();
      if (fallbackToken) {
        headers['Authorization'] = `Bearer ${fallbackToken}`;
      }
    }
  } else {
    const fallbackToken = getAccessToken();
    if (fallbackToken) {
      headers['Authorization'] = `Bearer ${fallbackToken}`;
    }
  }

  return headers;
}

async function fetchWithAuth(url: string, options: RequestInit = {}): Promise<Response> {
  const authHeaders = await getAuthHeaders();
  const mergedHeaders = {
    ...authHeaders,
    ...(options.headers || {}),
  };

  return fetch(url, {
    ...options,
    headers: mergedHeaders,
  });
}

export const apiClient = {
  // Master Data APIs
  getProducts: async (): Promise<DropdownOption[]> => {
    try {
      const res = await fetchWithAuth(`${API_BASE_URL}/api/products`);
      if (!res.ok) return [];
      const json: ApiResponse<DropdownOption[]> = await res.json();
      return json.success ? json.data : [];
    } catch (e) {
      console.warn('Failed to load products:', e);
      return [];
    }
  },

  getStates: async (): Promise<DropdownOption[]> => {
    try {
      const res = await fetchWithAuth(`${API_BASE_URL}/api/states`);
      if (!res.ok) return [];
      const json: ApiResponse<DropdownOption[]> = await res.json();
      return json.success ? json.data : [];
    } catch (e) {
      console.warn('Failed to load states:', e);
      return [];
    }
  },

  getBranches: async (stateName?: string, query?: string): Promise<DropdownOption[]> => {
    try {
      const params = new URLSearchParams();
      if (stateName) params.append('state', stateName);
      if (query) params.append('q', query);
      const res = await fetchWithAuth(`${API_BASE_URL}/api/branches?${params.toString()}`);
      if (!res.ok) return [];
      const json: ApiResponse<DropdownOption[]> = await res.json();
      return json.success ? json.data : [];
    } catch (e) {
      console.warn('Failed to load branches:', e);
      return [];
    }
  },

  getSalesExecutives: async (query?: string): Promise<DropdownOption[]> => {
    try {
      const params = new URLSearchParams();
      if (query) params.append('q', query);
      const res = await fetchWithAuth(`${API_BASE_URL}/api/sales-executives?${params.toString()}`);
      if (!res.ok) return [];
      const json: ApiResponse<DropdownOption[]> = await res.json();
      return json.success ? json.data : [];
    } catch (e) {
      console.warn('Failed to load sales executives:', e);
      return [];
    }
  },

  getReferenceData: async (): Promise<ReferenceData> => {
    try {
      const res = await fetchWithAuth(`${API_BASE_URL}/api/reference-data`);
      if (!res.ok) return { propertyTypes: [], propertyStatuses: [], entityTypes: [] };
      const json: ApiResponse<ReferenceData> = await res.json();
      return json.success ? json.data : { propertyTypes: [], propertyStatuses: [], entityTypes: [] };
    } catch (e) {
      console.warn('Failed to load reference data:', e);
      return { propertyTypes: [], propertyStatuses: [], entityTypes: [] };
    }
  },

  // Leads CRUD
  getLeads: async (params: {
    page?: number;
    pageSize?: number;
    search?: string;
    product?: string;
    branch?: string;
    state?: string;
    salesExecutive?: string;
    month?: string;
    createdDate?: string;
    createdFrom?: string;
    createdTo?: string;
    name?: string;
    icNumber?: string;
    phone?: string;
    status?: string;
  }): Promise<PagedResult<LeadRecord>> => {
    try {
      const query = new URLSearchParams();
      if (params.page) query.append('page', params.page.toString());
      if (params.pageSize) query.append('pageSize', params.pageSize.toString());
      if (params.search) query.append('search', params.search);
      if (params.product) query.append('product', params.product);
      if (params.branch) query.append('branch', params.branch);
      if (params.state) query.append('state', params.state);
      if (params.salesExecutive) query.append('salesExecutive', params.salesExecutive);
      if (params.month) query.append('month', params.month);
      if (params.createdDate) query.append('createdDate', params.createdDate);
      if (params.createdFrom) query.append('createdFrom', params.createdFrom);
      if (params.createdTo) query.append('createdTo', params.createdTo);
      if (params.name) query.append('name', params.name);
      if (params.icNumber) query.append('icNumber', params.icNumber);
      if (params.phone) query.append('phone', params.phone);
      if (params.status) query.append('status', params.status);

      const res = await fetchWithAuth(`${API_BASE_URL}/api/leads?${query.toString()}`);
      if (!res.ok) {
        return { items: [], totalRecords: 0, page: 1, pageSize: params.pageSize || 10, totalPages: 1 };
      }
      const json: ApiResponse<PagedResult<LeadRecord>> = await res.json();
      return json.success ? json.data : { items: [], totalRecords: 0, page: 1, pageSize: 10, totalPages: 1 };
    } catch (e) {
      console.warn('Failed to load leads:', e);
      return { items: [], totalRecords: 0, page: 1, pageSize: 10, totalPages: 1 };
    }
  },

  getLeadById: async (id: string): Promise<LeadRecord | null> => {
    try {
      const res = await fetchWithAuth(`${API_BASE_URL}/api/leads/${id}`);
      if (!res.ok) return null;
      const json: ApiResponse<LeadRecord> = await res.json();
      return json.success ? json.data : null;
    } catch (e) {
      console.warn('Failed to load lead by ID:', e);
      return null;
    }
  },

  // Resolves the real LeadRecord (200/201, applied as it always has) or an ApprovalPendingDto (202,
  // still success:true) if the "Lead" module has a checker assigned — callers must check
  // isApprovalPending(response.data) before treating it as the real thing.
  createLead: async (formData: any): Promise<ApiResponse<LeadRecord | ApprovalPendingDto>> => {
    const res = await fetchWithAuth(`${API_BASE_URL}/api/leads`, {
      method: 'POST',
      body: JSON.stringify(formData),
    });
    return await res.json();
  },

  updateLead: async (id: string, updateData: any): Promise<ApiResponse<LeadRecord | ApprovalPendingDto>> => {
    const res = await fetchWithAuth(`${API_BASE_URL}/api/leads/${id}`, {
      method: 'PUT',
      body: JSON.stringify(updateData),
    });
    return await res.json();
  },

  deleteLead: async (id: string, deleteReason: string): Promise<ApiResponse<boolean | ApprovalPendingDto>> => {
    const res = await fetchWithAuth(`${API_BASE_URL}/api/leads/${id}`, {
      method: 'DELETE',
      body: JSON.stringify({ deleteReason }),
    });
    return await res.json();
  },

  logLeadView: async (id: string): Promise<void> => {
    try {
      await fetchWithAuth(`${API_BASE_URL}/api/leads/${id}/view-audit`, { method: 'POST' });
    } catch (err) {
      console.error('Failed to log view audit:', err);
    }
  },

  // Field Settings — Lead Management's own implementation, separate from Customer 360's.
  // getProducts() above deliberately returns {value:Name, label:Name} with no id (every existing
  // consumer matches by name) — Field Settings needs the real Guid to call
  // GET/PUT /api/lead-field-config/{productId}, hence this separate endpoint.
  getProductsWithId: async (): Promise<{ id: string; name: string }[]> => {
    try {
      const res = await fetchWithAuth(`${API_BASE_URL}/api/products/full`);
      if (!res.ok) return [];
      const json: ApiResponse<{ id: string; name: string }[]> = await res.json();
      return json.success ? json.data : [];
    } catch {
      return [];
    }
  },

  getFieldConfig: async (productId: string): Promise<LeadFieldConfig[]> => {
    try {
      const res = await fetchWithAuth(`${API_BASE_URL}/api/lead-field-config/${productId}`);
      if (!res.ok) return [];
      const json: ApiResponse<LeadFieldConfig[]> = await res.json();
      return json.success ? json.data : [];
    } catch {
      return [];
    }
  },

  /**
   * The formats administrators defined in Settings → Manage Formats. Empty when they cannot be read:
   * a field rule naming one then is not checked here, and the server — which reads the catalog itself —
   * still is.
   */
  getFormatPresets: async (): Promise<CustomPreset[]> => {
    try {
      const res = await fetchWithAuth(`${API_BASE_URL}/api/lead-field-config/formats`);
      if (!res.ok) return [];
      const json: ApiResponse<CustomPreset[]> = await res.json();
      return json.success ? json.data : [];
    } catch {
      return [];
    }
  },

  /**
   * Field Settings' own read: the rows plus the version they were read at, so a save can be refused if
   * someone else saved in between rather than silently replacing their work.
   */
  getFieldConfigForEditing: async (productId: string): Promise<{ fields: LeadFieldConfig[]; version: string | null }> => {
    const res = await fetchWithAuth(`${API_BASE_URL}/api/lead-field-config/${productId}`);
    if (!res.ok) throw new Error('Could not load field settings for this product.');
    const json: ApiResponse<LeadFieldConfig[]> = await res.json();
    return { fields: json.success ? json.data : [], version: res.headers.get('ETag') };
  },

  /** Saves against `version` (the ETag read with the rows); a 409 means someone else saved first. */
  updateFieldConfig: async (
    productId: string,
    fields: LeadFieldConfig[],
    version?: string | null,
  ): Promise<ApiResponse<LeadFieldConfig[] | ApprovalPendingDto> & { version?: string | null }> => {
    const res = await fetchWithAuth(`${API_BASE_URL}/api/lead-field-config/${productId}`, {
      method: 'PUT',
      body: JSON.stringify(fields),
      headers: version ? { 'If-Match': version } : undefined,
    });
    return { ...(await res.json()), version: res.headers.get('ETag') };
  },

  getAuditLogs: async (params: {
    page?: number;
    pageSize?: number;
    search?: string;
    actionType?: string;
    entityId?: string;
    /**
     * Inclusive ISO 8601 instants, named the way every other log endpoint on the platform names
     * them — the endpoint's old `startDate`/`endDate` were date-only strings that discarded the time
     * of day, and nothing had ever sent them because no UI here offered a date filter.
     */
    from?: string;
    to?: string;
    /** Name or role, case-insensitive substring. */
    actor?: string;
    /** 'SUCCESS' or 'FAILED'. */
    status?: string;
  }): Promise<PagedResult<any>> => {
    try {
      const query = new URLSearchParams();
      if (params.page) query.append('page', params.page.toString());
      if (params.pageSize !== undefined) query.append('pageSize', params.pageSize.toString());
      if (params.search) query.append('search', params.search);
      if (params.actionType) query.append('actionType', params.actionType);
      if (params.entityId) query.append('entityId', params.entityId);
      if (params.from) query.append('from', params.from);
      if (params.to) query.append('to', params.to);
      if (params.actor) query.append('actor', params.actor);
      if (params.status) query.append('status', params.status);

      const res = await fetchWithAuth(`${API_BASE_URL}/api/auditlogs?${query.toString()}`);
      if (!res.ok) {
        return { items: [], totalRecords: 0, page: 1, pageSize: 10, totalPages: 1 };
      }
      const json: ApiResponse<PagedResult<any>> = await res.json();
      return json.success
        ? json.data
        : { items: [], totalRecords: 0, page: 1, pageSize: 10, totalPages: 1 };
    } catch (e) {
      console.warn('Failed to load audit logs:', e);
      return { items: [], totalRecords: 0, page: 1, pageSize: 10, totalPages: 1 };
    }
  },

  getAuditLogById: async (id: string): Promise<any> => {
    try {
      const res = await fetchWithAuth(`${API_BASE_URL}/api/auditlogs/${id}`);
      if (!res.ok) return null;
      const json: ApiResponse<any> = await res.json();
      return json.success ? json.data : null;
    } catch (e) {
      console.warn('Failed to load audit log:', e);
      return null;
    }
  },

  // Dashboard APIs
  getDashboardKpis: async (params?: DashboardFilterParams): Promise<KpiSummary> => {
    try {
      const res = await fetchWithAuth(`${API_BASE_URL}/api/dashboard/kpis${buildDashboardQuery(params)}`);
      if (!res.ok) {
        return { totalLeads: 0, newLeads: 0, inProgressLeads: null, convertedLeads: 0, conversionRate: null };
      }
      const json: ApiResponse<KpiSummary> = await res.json();
      return json.success
        ? json.data
        : { totalLeads: 0, newLeads: 0, inProgressLeads: null, convertedLeads: 0, conversionRate: null };
    } catch (e) {
      console.warn('Failed to load dashboard KPIs:', e);
      return { totalLeads: 0, newLeads: 0, inProgressLeads: null, convertedLeads: 0, conversionRate: null };
    }
  },

  getLeadsOverTime: async (params?: DashboardFilterParams): Promise<TimeSeriesPoint[]> => {
    try {
      const res = await fetchWithAuth(`${API_BASE_URL}/api/dashboard/leads-over-time${buildDashboardQuery(params)}`);
      if (!res.ok) return [];
      const json: ApiResponse<TimeSeriesPoint[]> = await res.json();
      return json.success ? json.data : [];
    } catch (e) {
      console.warn('Failed to load leads over time:', e);
      return [];
    }
  },

  getLeadsByProduct: async (params?: DashboardFilterParams): Promise<ProductDistribution[]> => {
    try {
      const res = await fetchWithAuth(`${API_BASE_URL}/api/dashboard/leads-by-product${buildDashboardQuery(params)}`);
      if (!res.ok) return [];
      const json: ApiResponse<ProductDistribution[]> = await res.json();
      return json.success ? json.data : [];
    } catch (e) {
      console.warn('Failed to load leads by product:', e);
      return [];
    }
  },

  getLeadsByBranch: async (params?: DashboardFilterParams): Promise<BranchDistribution[]> => {
    try {
      const res = await fetchWithAuth(`${API_BASE_URL}/api/dashboard/leads-by-branch${buildDashboardQuery(params)}`);
      if (!res.ok) return [];
      const json: ApiResponse<BranchDistribution[]> = await res.json();
      return json.success ? json.data : [];
    } catch (e) {
      console.warn('Failed to load leads by branch:', e);
      return [];
    }
  },

  getRecentLeads: async (params?: DashboardFilterParams, limit = 5): Promise<LeadRecord[]> => {
    try {
      const q = buildDashboardQuery(params);
      const connector = q ? '&' : '?';
      const res = await fetchWithAuth(`${API_BASE_URL}/api/dashboard/recent-leads${q}${connector}limit=${limit}`);
      if (!res.ok) return [];
      const json: ApiResponse<LeadRecord[]> = await res.json();
      return json.success ? json.data : [];
    } catch (e) {
      console.warn('Failed to load recent leads:', e);
      return [];
    }
  },

  getTopSalesExecutives: async (params?: DashboardFilterParams, limit = 5): Promise<TopSalesExecutive[]> => {
    try {
      const q = buildDashboardQuery(params);
      const connector = q ? '&' : '?';
      const res = await fetchWithAuth(`${API_BASE_URL}/api/dashboard/top-sales-executives${q}${connector}limit=${limit}`);
      if (!res.ok) return [];
      const json: ApiResponse<TopSalesExecutive[]> = await res.json();
      return json.success ? json.data : [];
    } catch (e) {
      console.warn('Failed to load top sales executives:', e);
      return [];
    }
  },
};
