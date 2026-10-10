import { create } from 'zustand';
import { api, ApiError } from '../services/api';
import { useCustomerStore } from './customerStore';
import type { CustomerProduct, ProductDetail } from '../types/api';
import { readStoredPageSize } from '@omniconnect/ui';

// ---------------------------------------------------------------------------
// Stale-response guard for loadProducts, mirroring customerStore's
// _searchVersion pattern.
//
// Without this, an in-flight request for an older page/customer that
// resolves AFTER a newer one (e.g. two rapid page-size clicks, a customer
// switch shortly after the products effect fired, or React.StrictMode's
// dev-only double-invoke of effects) can silently overwrite a fresh, correct
// product list with stale or empty data — this is a real, unguarded race
// distinct from the (already-guarded) customer-profile race.
// ---------------------------------------------------------------------------
let _productsVersion = 0;

/** The Product Held row (`CustomerProduct`) merged with whatever the matching
 * product-detail endpoint returned (`ProductDetail`) — see openProductModal.
 * Both sides are optional CRM fields, so this is a genuine dynamic merge of
 * two distinct response shapes, not a single fixed CRM contract. */
export type SelectedProductDetails = (ProductDetail & Partial<CustomerProduct>) | CustomerProduct;

interface ProductStoreState {
  products: CustomerProduct[];
  loading: boolean;
  error: string | null;
  // Was dropped entirely (only `.message` was ever stored) — see interactionStore.ts's identical
  // fix for the full rationale: without this, every consumer of `error` always fell into
  // getFriendlyErrorMessage's "no status" branch and showed a generic connection message,
  // regardless of whether the real cause was a 500, a 403, or an actual network failure.
  errorStatus: number | null;

  // Pagination
  pageNumber: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;

  // Filters
  searchQuery: string;
  categoryFilter: string;

  // Active Modal Detail
  selectedProductDetails: SelectedProductDetails | null;
  selectedProductType: string;
  modalOpen: boolean;
  loadingDetails: boolean;
  modalDetailsError: string | null;

  setSearchQuery: (query: string) => void;
  setCategoryFilter: (filter: string) => void;
  setPageNumber: (page: number) => void;
  setPageSize: (size: number) => void;
  openProductModal: (accountNo: string, type: string) => Promise<void>;
  closeProductModal: () => void;
  loadProducts: (customerId: string, page?: number, size?: number) => Promise<void>;
}

export const useProductStore = create<ProductStoreState>((set, get) => ({
  products: [],
  loading: false,
  error: null,
  errorStatus: null,

  // Pagination
  pageNumber: 1,
  pageSize: readStoredPageSize('c360.products', 5),
  totalCount: 0,
  totalPages: 1,

  // Filters
  searchQuery: '',
  categoryFilter: '',

  // Active Modal Detail
  selectedProductDetails: null,
  selectedProductType: '',
  modalOpen: false,
  loadingDetails: false,
  modalDetailsError: null,

  setSearchQuery: (query) => set({ searchQuery: query, pageNumber: 1 }),
  setCategoryFilter: (filter) => set({ categoryFilter: filter, pageNumber: 1 }),
  setPageNumber: (page) => set({ pageNumber: page }),
  setPageSize: (size) => set({ pageSize: size, pageNumber: 1 }),

  openProductModal: async (accountNo, type) => {
    // 1. Locate the summary product row already present in the list
    const prodItem = get().products.find(
      (p) => p.accountNumber === accountNo || (p as unknown as { accountNo?: string }).accountNo === accountNo
    );

    // Immediately open modal with existing summary data so the user has instant feedback
    set({
      modalOpen: true,
      loadingDetails: true,
      selectedProductDetails: prodItem || null,
      selectedProductType: type,
      modalDetailsError: null,
    });

    try {
      let details: SelectedProductDetails | null = null;
      const normType = ((type || '') + ' ' + (prodItem?.type || '')).toLowerCase();
      const normCategory = (prodItem?.productCategory || '').toLowerCase();

      const customerState = useCustomerStore.getState();
      const isCorp = customerState.customerType === 'corporate';
      const corpProfile = customerState.corporateProfile || (isCorp ? (customerState.profile as Record<string, unknown> | null) : null);
      const indProfile = customerState.individualProfile || (!isCorp ? (customerState.profile as Record<string, unknown> | null) : null);

      // Robust customer ID resolution across all profile structures and fallback to product item
      const lookupId = (isCorp
        ? ((corpProfile as { brn?: string })?.brn || (corpProfile as { customerId?: string })?.customerId || customerState.activeCorporateId || prodItem?.partyId || '')
        : ((indProfile as { nationalId?: string })?.nationalId || (indProfile as { phprId?: string })?.phprId || (indProfile as { oldId?: string })?.oldId || (indProfile as { passport?: string })?.passport || customerState.activeIndividualId || prodItem?.phprId || prodItem?.partyId || '')
      ).trim();
      const nationalId = lookupId;
      const cleanAccountNo = (accountNo || prodItem?.accountNumber || '').trim();

      if (cleanAccountNo) {
        if (normType.includes('loan') || normType.includes('financing') || normType.includes('hire purchase') || normCategory.includes('loan') || normCategory.includes('financing')) {
          const res = await api.getLoanProduct(lookupId, cleanAccountNo);
          details = res.data;
        } else if (normType.includes('deposit') || normType.includes('casa') || normType.includes('saving') || normType.includes('current') || normCategory.includes('deposit') || normCategory.includes('casa')) {
          const res = await api.getDepositProduct(lookupId, cleanAccountNo);
          details = res.data;
        } else if (normType.includes('card') || normCategory.includes('card')) {
          const cardType = prodItem?.cardType || 'CR';
          const res = await api.getCardProduct(nationalId, cleanAccountNo, cardType);
          details = res.data;
        } else if (normType.includes('gold') || normCategory.includes('gold')) {
          const res = await api.getGoldProduct(nationalId, cleanAccountNo);
          details = res.data;
        } else if (normType.includes('unit trust') || normCategory.includes('unit trust') || normType.includes('investment') || normCategory.includes('investment')) {
          const res = await api.getUnitTrustProduct(nationalId, cleanAccountNo);
          details = (res.data && res.data[0]) || null;
        } else if (normType.includes('will') || normCategory.includes('will')) {
          const res = await api.getWillWritingProduct(nationalId, cleanAccountNo);
          details = (res.data && res.data[0]) || null;
        } else if (normType.includes('wm') || normType.includes('wealth') || normType.includes('takaful') || normType.includes('insurance') || normCategory.includes('wm') || normCategory.includes('wealth') || normCategory.includes('takaful')) {
          const res = await api.getWmProduct(nationalId, cleanAccountNo);
          details = res.data;
        } else {
          details = prodItem || null;
        }
      }

      if (details && prodItem) {
        details = { ...prodItem, ...details };
      } else if (!details && prodItem) {
        details = prodItem;
      }

      set({ selectedProductDetails: details, loadingDetails: false, modalDetailsError: null });
    } catch (err) {
      console.warn('Could not fetch deep-dive product details, using product summary data:', err);
      // Fallback gracefully to summary product item so user can still view the product drawer
      const fallbackDetails = prodItem || null;
      // CRITICAL: NEVER set store error / errorStatus here! Setting error on productStore
      // causes Customer360 to replace the whole products table with "No customer was found...".
      set({
        selectedProductDetails: fallbackDetails,
        modalDetailsError: fallbackDetails ? null : (err as ApiError).message || 'Could not load product details.',
        loadingDetails: false,
      });
    }
  },

  closeProductModal: () => set({ selectedProductDetails: null, modalOpen: false, selectedProductType: '', modalDetailsError: null }),

  loadProducts: async (customerId, page, size) => {
    if (!customerId) return;
    const version = ++_productsVersion;
    set({ loading: true, error: null, errorStatus: null });

    try {
      const pageNum = page !== undefined ? page : get().pageNumber;
      const sizeVal = size !== undefined ? size : get().pageSize;
      const customerType = useCustomerStore.getState().customerType;
      const apiType = customerType === 'corporate' ? 'CORPORATE' : 'INDIVIDUAL';
      const res = await api.getCustomerProducts(customerId, pageNum, sizeVal, apiType);

      // Discard if a newer load was started while this one was in-flight
      if (version !== _productsVersion) return;

      set({
        products: res.data || [],
        totalCount: res.totalCount || 0,
        totalPages: res.totalPages || 1,
        ...(page !== undefined && { pageNumber: page }),
        ...(size !== undefined && { pageSize: size }),
        loading: false,
      });
    } catch (err) {
      if (version !== _productsVersion) return;
      const apiErr = err as ApiError;
      if (apiErr.status === 404) {
        // A 404 from the CRM means no products exist for this customer ID — valid empty list
        set({
          products: [],
          totalCount: 0,
          totalPages: 1,
          loading: false,
          error: null,
          errorStatus: null,
        });
        return;
      }
      set({
        products: [],
        totalCount: 0,
        error: apiErr.message,
        errorStatus: apiErr.status ?? null,
        loading: false,
      });
      console.error('Error loading products:', err);
    }
  },
}));
