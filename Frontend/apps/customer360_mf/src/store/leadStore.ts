import { create } from 'zustand';
import { api, ApiError } from '../services/api';
import type { LeadRecord } from '../types/api';
import { readStoredPageSize } from '@omniconnect/ui';

// Stale-response guard for loadCustomerLeads (mirrors interactionStore's _interactionsVersion)
let _leadsVersion = 0;

export interface LeadFilterCriteria {
  icNumber?: string;
  name?: string;
  phone?: string;
  search?: string;
}

interface LeadStoreState {
  leads: LeadRecord[];
  loading: boolean;
  error: string | null;
  errorStatus: number | null;

  // Pagination
  pageNumber: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;

  // Filters
  searchQuery: string;
  statusFilter: string;

  // Active Lead Detail Drawer
  selectedLead: LeadRecord | null;
  drawerOpen: boolean;

  setSearchQuery: (query: string) => void;
  setStatusFilter: (filter: string) => void;
  setPageNumber: (page: number) => void;
  setPageSize: (size: number) => void;
  openLeadDrawer: (lead: LeadRecord) => void;
  closeLeadDrawer: () => void;
  reset: () => void;
  loadCustomerLeads: (
    criteria: LeadFilterCriteria,
    options?: { fresh?: boolean }
  ) => Promise<void>;
}

export const useLeadStore = create<LeadStoreState>((set, get) => ({
  leads: [],
  loading: false,
  error: null,
  errorStatus: null,

  pageNumber: 1,
  pageSize: readStoredPageSize('c360.leads', 5),
  totalCount: 0,
  totalPages: 1,

  searchQuery: '',
  statusFilter: '',

  selectedLead: null,
  drawerOpen: false,

  setSearchQuery: (query) => set({ searchQuery: query, pageNumber: 1 }),
  setStatusFilter: (filter) => set({ statusFilter: filter, pageNumber: 1 }),
  setPageNumber: (page) => set({ pageNumber: page }),
  setPageSize: (size) => set({ pageSize: size, pageNumber: 1 }),

  openLeadDrawer: (lead) => set({ selectedLead: lead, drawerOpen: true }),
  closeLeadDrawer: () => set({ selectedLead: null, drawerOpen: false }),

  reset: () =>
    set({
      leads: [],
      loading: false,
      error: null,
      errorStatus: null,
      pageNumber: 1,
      totalCount: 0,
      totalPages: 1,
      searchQuery: '',
      statusFilter: '',
      selectedLead: null,
      drawerOpen: false,
    }),

  loadCustomerLeads: async (criteria, options) => {
    const version = ++_leadsVersion;
    set({ loading: true, error: null, errorStatus: null });

    try {
      const { pageNumber, pageSize, searchQuery, statusFilter } = get();
      const res = await api.getCustomerLeads({
        page: pageNumber,
        pageSize,
        search: searchQuery || criteria.search || undefined,
        icNumber: criteria.icNumber || undefined,
        name: criteria.name || undefined,
        phone: criteria.phone || undefined,
        status: statusFilter || undefined,
        fresh: options?.fresh,
      });

      if (version !== _leadsVersion) return;

      if (res && res.data) {
        set({
          leads: res.data.items || [],
          totalCount: res.data.totalRecords || 0,
          totalPages: res.data.totalPages || 1,
          loading: false,
        });
      } else {
        set({
          leads: [],
          totalCount: 0,
          totalPages: 1,
          loading: false,
        });
      }
    } catch (err) {
      if (version !== _leadsVersion) return;
      const apiErr = err as ApiError;
      if (apiErr.status === 404) {
        set({
          leads: [],
          totalCount: 0,
          totalPages: 1,
          loading: false,
        });
      } else {
        set({
          loading: false,
          error: apiErr.message || 'Failed to load leads from LeadService.',
          errorStatus: apiErr.status ?? null,
        });
      }
    }
  },
}));
