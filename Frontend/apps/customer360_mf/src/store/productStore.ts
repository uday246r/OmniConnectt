import { create } from 'zustand';
import { api, ApiError } from '../services/api';
import { useCustomerStore } from './customerStore';
import type { CustomerProduct, ProductDetail } from '../types/api';
import { readStoredPageSize } from '@omniremit/ui';

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

  setSearchQuery: (query) => set({ searchQuery: query, pageNumber: 1 }),
  setCategoryFilter: (filter) => set({ categoryFilter: filter, pageNumber: 1 }),
  setPageNumber: (page) => set({ pageNumber: page }),
  setPageSize: (size) => set({ pageSize: size, pageNumber: 1 }),

  openProductModal: async (accountNo, type) => {
    set({ modalOpen: true, loadingDetails: true, selectedProductDetails: null, selectedProductType: type });

    try {
      let details: SelectedProductDetails | null = null;
      const prodItem = get().products.find((p) => p.accountNumber === accountNo);
      const normType = (type || '').toLowerCase();
      const normCategory = (prodItem?.productCategory || '').toLowerCase();

      const customerState = useCustomerStore.getState();
      const isCorp = customerState.customerType === 'corporate';

      // Per the CRM API spec's sample requests, every product detail endpoint
      // (deposit/loan/cards/gold/wm) takes "National ID / BRN" as its "Id" param —
      // for Individual customers this is the NRIC (nationalId), NOT the phprId.
      // For Corporate, it is the BRN.
      const lookupId = isCorp
        ? (customerState.profile as { brn?: string } | null)?.brn || customerState.activeCorporateId
        : (customerState.profile as { nationalId?: string } | null)?.nationalId || customerState.activeIndividualId;
      const nationalId = lookupId;

      // Method names below match api.ts's actual exports (getLoanDetails/getDepositDetails/etc. never
      // existed — every branch here threw "api.<name> is not a function" the instant a user opened a
      // product's details, for every product type).
      if (normType.includes('loan') || normType.includes('financing')) {
        const res = await api.getLoanProduct(lookupId, accountNo);
        details = res.data;
      } else if (normType.includes('deposit') || normType.includes('casa')) {
        const res = await api.getDepositProduct(lookupId, accountNo);
        details = res.data;
      } else if (normType.includes('card')) {
        const cardType = prodItem?.cardType || 'CR';
        const res = await api.getCardProduct(nationalId, accountNo, cardType);
        details = res.data;
      } else if (normType.includes('gold') || normCategory.includes('gold')) {
        const res = await api.getGoldProduct(nationalId, accountNo);
        details = res.data;
      } else if (normType.includes('unit trust') || normCategory.includes('unit trust')) {
        const res = await api.getUnitTrustProduct(nationalId, accountNo);
        details = (res.data && res.data[0]) || null;
      } else if (normType.includes('will') || normCategory.includes('will')) {
        const res = await api.getWillWritingProduct(nationalId, accountNo);
        details = (res.data && res.data[0]) || null;
      } else if (normType.includes('wm') || normType.includes('wealth') || normType.includes('takaful')) {
        // accountNo doubles as policyNo here — CustomerProduct exposes one generic "accountNumber"
        // field regardless of underlying product type, and for a WM row that value IS the policy no.
        const res = await api.getWmProduct(nationalId, accountNo);
        details = res.data;
      } else {
        // Fallback to basic product item
        details = prodItem || null;
      }

      if (details && prodItem) {
        details = { ...prodItem, ...details };
      }

      set({ selectedProductDetails: details, loadingDetails: false });
    } catch (err) {
      console.error('Error fetching product details:', err);
      set({ error: (err as ApiError).message, errorStatus: (err as ApiError).status ?? null, loadingDetails: false });
    }
  },

  closeProductModal: () => set({ selectedProductDetails: null, modalOpen: false, selectedProductType: '' }),

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
      set({ error: (err as ApiError).message, errorStatus: (err as ApiError).status ?? null, loading: false });
      console.error('Error loading products:', err);
    }
  },
}));
