import type {
  IndividualProfile,
  CorporateProfile,
  ContactDetail,
  CustomerProduct,
  Interaction,
  DepositProduct,
  LoanProduct,
  CardsProduct,
  GoldProduct,
  WmProduct,
  UnitTrustProduct,
  WillWritingProduct,
  LookupOptions,
  AuditLog,
  FieldConfig,
  FieldConfigProfileType,
  ApprovalPendingDto,
} from '../types/api';
import { getAccessToken, ensureFreshAccessToken, getCurrentUser, isRunningInHost } from '../api/hostBridge';

export const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL || 'http://localhost:5059';

// ---------------------------------------------------------------------------
// Response envelopes
// ---------------------------------------------------------------------------
interface ApiEnvelope<T> {
  status: number;
  data: T;
}

interface PaginatedEnvelope<T> extends ApiEnvelope<T[]> {
  pageNumber: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
}

export class ApiError extends Error {
  status?: number;
  constructor(message: string, status?: number) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/*
 * `getLoggedInUser()` and the 'X-Staff-User' header it fed are gone.
 *
 * The header named who an audit entry should be attributed to, read from a browser-side guess that
 * fell back through sessionStorage, localStorage and finally the literal string 'Admin User'. The
 * backend stopped trusting it some time ago — AuditController's actor now comes from the verified
 * token and nowhere else — but this kept sending it, so the request still carried a field that read
 * like an identity claim and was in fact whatever this tab happened to have in storage.
 *
 * Nothing replaces it. The token already says who the caller is.
 */
async function request<T>(endpoint: string, options: RequestInit = {}): Promise<T> {
  let token: string | null = null;

  if (isRunningInHost()) {
    try {
      token = await ensureFreshAccessToken();
    } catch {
      token = getAccessToken();
    }
  } else {
    token = getAccessToken();
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> | undefined),
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  let response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });

  // Handle token expiry (401): retry once if running inside host
  if (response.status === 401 && isRunningInHost()) {
    console.warn('[Auth] Token expired in customer360_mf. Requesting fresh token...');
    try {
      token = await ensureFreshAccessToken();
      headers['Authorization'] = `Bearer ${token}`;
      response = await fetch(`${API_BASE_URL}${endpoint}`, { ...options, headers });
    } catch (err) {
      console.error('[Auth] Failed to refresh token:', err);
    }
  }

  if (!response.ok) {
    const errData = await response.json().catch(() => ({}) as { detail?: string; message?: string });
    throw new ApiError(errData.detail || errData.message || `HTTP error ${response.status}`, response.status);
  }

  return response.json();
}

export const api = {
  // Search dropdown options config
  getSearchOptions: (): Promise<ApiEnvelope<LookupOptions>> => request('/v1/lookups'),

  // Field-visibility/masking config the detail pages render from — see FieldConfig.cs
  getFieldConfig: (profileType: FieldConfigProfileType): Promise<ApiEnvelope<FieldConfig[]>> =>
    request(`/v1/field-config/${profileType.toLowerCase()}`),

  // Resolves the real full field list (status 200, applied as it always has) or an ApprovalPendingDto
  // (status 202) if the "fieldsettings" module has a checker assigned — callers must check
  // isApprovalPending(res.data) before treating it as the real thing.
  updateFieldConfig: (
    profileType: FieldConfigProfileType,
    fields: FieldConfig[]
  ): Promise<ApiEnvelope<FieldConfig[] | ApprovalPendingDto>> =>
    request(`/v1/field-config/${profileType.toLowerCase()}`, {
      method: 'PUT',
      body: JSON.stringify(fields),
    }),

  // Individual profile
  getIndividualProfile: (
    id: string,
    type = 'NRIC',
    subtype = ''
  ): Promise<ApiEnvelope<IndividualProfile[]>> =>
    request(
      `/v1/indprofile?type=${type}&id=${encodeURIComponent(id)}${subtype ? `&subtype=${encodeURIComponent(subtype)}` : ''}`
    ),

  // Corporate profile
  getCorporateProfile: (id: string, type = 'BRN'): Promise<ApiEnvelope<CorporateProfile[]>> =>
    request(`/v1/corpprofile?type=${encodeURIComponent(type)}&id=${encodeURIComponent(id)}`),
  getAllCorporateProfiles: (): Promise<ApiEnvelope<CorporateProfile[]>> => request('/v1/corpprofile'),

  // Contact info
  getContactInfo: (id: string, type = ''): Promise<ApiEnvelope<ContactDetail>> =>
    request(`/v1/contactinfo?id=${encodeURIComponent(id)}${type ? `&type=${encodeURIComponent(type)}` : ''}`),

  // Customer products (holdings)
  getCustomerProducts: (
    id: string,
    page = 1,
    size = 10,
    type = ''
  ): Promise<PaginatedEnvelope<CustomerProduct>> =>
    request(
      `/v1/customerproduct?id=${encodeURIComponent(id)}&pageNumber=${page}&pageSize=${size}${type ? `&type=${encodeURIComponent(type)}` : ''}`
    ),

  // Interactions (Cases)
  getCustomerInteractions: (
    id: string,
    page = 1,
    size = 10
  ): Promise<PaginatedEnvelope<Interaction>> =>
    request(`/v1/interactions/${encodeURIComponent(id)}?pageNumber=${page}&pageSize=${size}`),

  // Product deep-dives.
  //
  // Every one of these previously pointed at a URL that does not exist on this backend at all — e.g.
  // `/v1/loanproduct/{id}` — a leftover from an earlier draft that was never reconciled against the
  // real controller (Backend/Customer360Service/Controllers/ProductController.cs). Every real route
  // is `/v1/product/<kind>`, a query string (not a path segment), and needs BOTH the customer's id
  // and the specific product's account/policy number — a customer can hold more than one of a given
  // product type, so the id alone can't identify which one. Confirmed against the controller's own
  // route comments and parameter lists, not guessed.
  getDepositProduct: (id: string, accountNo: string): Promise<ApiEnvelope<DepositProduct>> =>
    request(`/v1/product/deposit?id=${encodeURIComponent(id)}&accountNo=${encodeURIComponent(accountNo)}`),

  getLoanProduct: (id: string, accountNo: string): Promise<ApiEnvelope<LoanProduct>> =>
    request(`/v1/product/loan?id=${encodeURIComponent(id)}&accountNo=${encodeURIComponent(accountNo)}`),

  getCardProduct: (id: string, accountNo: string, cardType: string): Promise<ApiEnvelope<CardsProduct>> =>
    request(
      `/v1/product/cards?id=${encodeURIComponent(id)}&accountNo=${encodeURIComponent(accountNo)}&type=${encodeURIComponent(cardType)}`
    ),

  getGoldProduct: (id: string, accountNo: string): Promise<ApiEnvelope<GoldProduct>> =>
    request(`/v1/product/gold?id=${encodeURIComponent(id)}&accountNo=${encodeURIComponent(accountNo)}`),

  getWmProduct: (id: string, policyNo: string): Promise<ApiEnvelope<WmProduct>> =>
    request(`/v1/product/wm?id=${encodeURIComponent(id)}&policyNo=${encodeURIComponent(policyNo)}`),

  // Unlike the five above, unittrust/willwriting return a LIST (`data: [...]`), not a single object —
  // matches the controller, which calls MapList rather than Map for these two. They also key on
  // `nric`, not `id`.
  getUnitTrustProduct: (nric: string, accountNo: string): Promise<ApiEnvelope<UnitTrustProduct[]>> =>
    request(`/v1/product/unittrust?nric=${encodeURIComponent(nric)}&accountNo=${encodeURIComponent(accountNo)}`),

  getWillWritingProduct: (nric: string, accountNo: string): Promise<ApiEnvelope<WillWritingProduct[]>> =>
    request(`/v1/product/willwriting?nric=${encodeURIComponent(nric)}&accountNo=${encodeURIComponent(accountNo)}`),

  // Audit Logs
  getAuditLogs: (params: {
    search?: string; action?: string; pageNumber?: number; pageSize?: number; from?: string; to?: string;
    /** 'SUCCESS' or 'FAILED'. */ status?: string;
    /** Stored actor text or actor id, case-insensitive. */ actor?: string;
    /** Customer name or id, case-insensitive substring. */ customer?: string;
    description?: string;
  } = {}): Promise<PaginatedEnvelope<AuditLog>> => {
    const query = new URLSearchParams();
    if (params.search) query.append('search', params.search);
    if (params.action) query.append('action', params.action);
    if (params.status) query.append('status', params.status);
    if (params.actor) query.append('actor', params.actor);
    if (params.customer) query.append('customer', params.customer);
    if (params.description) query.append('description', params.description);
    if (params.pageNumber) query.append('pageNumber', params.pageNumber.toString());
    if (params.pageSize) query.append('pageSize', params.pageSize.toString());
    // Inclusive ISO 8601 instants. This service accepted no date filter at all until its timestamp
    // column stopped being local-wall-clock text — see Models/AuditLog.Timestamp on the server.
    if (params.from) query.append('from', params.from);
    if (params.to) query.append('to', params.to);
    return request(`/v1/audit?${query.toString()}`);
  },

  /*
   * There is deliberately no `createAuditLog`/`logAudit` here, and no `POST /v1/audit` behind them.
   *
   * The browser used to tell the server what to record: the action, the description, the customer
   * and the outcome all came from this object's argument. Two things were wrong with that beyond
   * the obvious. A client can omit an action it would rather not record, and the gap is invisible
   * afterwards. And an entry written from the browser can only attest to what the browser did — a
   * "viewed sensitive data" row recorded a local unmask of a value already on the page, an event
   * the server never saw and cannot corroborate.
   *
   * Customer360Service now records profile lookups itself, from the endpoint that serves them.
   * The masked-field reveal has no server-side counterpart to record, because unmasking happens
   * entirely in this tab over data already fetched; making it auditable would mean masking
   * server-side and adding a real reveal request, which is a change to the 360 data contract and
   * not something to fake with a client-written row in the meantime.
   */
};
