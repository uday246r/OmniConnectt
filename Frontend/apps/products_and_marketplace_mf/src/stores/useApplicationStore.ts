import { create } from "zustand";
import { applicationApi } from "../services/applicationApi";
import type { ApplicationDetail, ApplicationInput, ApplicationListItem } from "../types/domain";

interface ApplicationState {
  items: ApplicationListItem[];
  totalCount: number;
  totalPages: number;
  loading: boolean;
  error: string | null;
  search: string;
  status: string | null;
  page: number;
  pageSize: number;
  selected: ApplicationDetail | null;
  selectedLoading: boolean;

  setSearch: (search: string) => void;
  setStatus: (status: string | null) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  fetchApplications: () => Promise<void>;
  fetchApplicationById: (id: string) => Promise<void>;
  clearSelected: () => void;
  createApplication: (input: ApplicationInput) => Promise<ApplicationDetail>;
  updateStatus: (id: string, status: string, note?: string) => Promise<void>;
}

export const useApplicationStore = create<ApplicationState>((set, get) => ({
  items: [],
  totalCount: 0,
  totalPages: 0,
  loading: false,
  error: null,
  search: "",
  status: null,
  page: 1,
  pageSize: 10,
  selected: null,
  selectedLoading: false,

  setSearch: (search) => set({ search, page: 1 }),
  setStatus: (status) => set({ status, page: 1 }),
  setPage: (page) => set({ page }),
  setPageSize: (pageSize) => set({ pageSize, page: 1 }),

  fetchApplications: async () => {
    const { search, status, page, pageSize } = get();
    set({ loading: true, error: null });
    try {
      const result = await applicationApi.search({ search: search || undefined, status: status || undefined, page, pageSize });
      set({ items: result.items, totalCount: result.totalCount, totalPages: result.totalPages, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  fetchApplicationById: async (id) => {
    set({ selectedLoading: true });
    try {
      const application = await applicationApi.getById(id);
      set({ selected: application, selectedLoading: false });
    } catch (err) {
      set({ selectedLoading: false, error: (err as Error).message });
    }
  },

  clearSelected: () => set({ selected: null }),

  createApplication: async (input) => {
    const created = await applicationApi.create(input);
    await get().fetchApplications();
    return created;
  },

  updateStatus: async (id, status, note) => {
    const updated = await applicationApi.updateStatus(id, status, note);
    await get().fetchApplications();
    if (get().selected?.id === id) set({ selected: updated });
  },
}));
