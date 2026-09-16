import { create } from 'zustand';
import { api, ApiError } from '../services/api';
import type { Interaction } from '../types/api';
import { readStoredPageSize } from '@omniconnect/ui';

// Stale-response guard for loadInteractions — see productStore.ts for the
// full rationale (mirrors customerStore's _searchVersion pattern).
let _interactionsVersion = 0;

interface InteractionStoreState {
  interactions: Interaction[];
  loading: boolean;
  error: string | null;
  // Was dropped entirely (only `.message` was ever stored), so every consumer of this error had no
  // way to tell a real 500/403 apart from a network failure — getFriendlyErrorMessage always fell
  // into its "no status" branch and showed a generic connection message regardless of the actual
  // cause. See Customer360.tsx's own errorStatus for the same pattern already used elsewhere.
  errorStatus: number | null;

  // Pagination
  pageNumber: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;

  // Filters
  searchQuery: string;
  statusFilter: string;

  // Active Modal Detail
  selectedCase: Interaction | null;
  modalOpen: boolean;

  setSearchQuery: (query: string) => void;
  setStatusFilter: (filter: string) => void;
  setPageNumber: (page: number) => void;
  setPageSize: (size: number) => void;
  openCaseModal: (caseDetail: Interaction) => void;
  closeCaseModal: () => void;
  loadInteractions: (customerId: string) => Promise<void>;
}

export const useInteractionStore = create<InteractionStoreState>((set, get) => ({
  interactions: [],
  loading: false,
  error: null,
  errorStatus: null,

  // Pagination
  pageNumber: 1,
  pageSize: readStoredPageSize('c360.interactions', 5),
  totalCount: 0,
  totalPages: 1,

  // Filters
  searchQuery: '',
  statusFilter: '',

  // Active Modal Detail
  selectedCase: null,
  modalOpen: false,

  setSearchQuery: (query) => set({ searchQuery: query, pageNumber: 1 }),
  setStatusFilter: (filter) => set({ statusFilter: filter, pageNumber: 1 }),
  setPageNumber: (page) => set({ pageNumber: page }),
  setPageSize: (size) => set({ pageSize: size, pageNumber: 1 }),

  openCaseModal: (caseDetail) => set({ selectedCase: caseDetail, modalOpen: true }),
  closeCaseModal: () => set({ selectedCase: null, modalOpen: false }),

  loadInteractions: async (customerId) => {
    if (!customerId) return;
    const version = ++_interactionsVersion;
    set({ loading: true, error: null, errorStatus: null });

    try {
      const { pageNumber, pageSize } = get();
      // `getInteractions` never existed on `api` (the real name is `getCustomerInteractions`) — this
      // threw on every single case load, meaning the Interactions tab has never once shown real data.
      const res = await api.getCustomerInteractions(customerId, pageNumber, pageSize);

      // Discard if a newer load was started while this one was in-flight
      if (version !== _interactionsVersion) return;

      set({
        interactions: res.data || [],
        totalCount: res.totalCount || 0,
        totalPages: res.totalPages || 1,
        loading: false,
      });
    } catch (err) {
      if (version !== _interactionsVersion) return;
      set({ error: (err as ApiError).message, errorStatus: (err as ApiError).status ?? null, loading: false });
      console.error('Error loading interactions:', err);
    }
  },
}));
