import { create } from "zustand";
import { promotionApi } from "../services/promotionApi";
import type { Promotion, PromotionInput, StatusCount } from "../types/domain";

let latestListRequest = 0;

interface PromotionState {
  items: Promotion[];
  totalCount: number;
  totalPages: number;
  /** Per-status counts for the whole filtered set; null until loaded or when they could not be. */
  statusCounts: StatusCount[] | null;
  loading: boolean;
  error: string | null;
  search: string;
  status: string | null;
  page: number;
  pageSize: number;

  setSearch: (search: string) => void;
  setStatus: (status: string | null) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  fetchPromotions: () => Promise<void>;
  createPromotion: (input: PromotionInput) => Promise<Promotion>;
  updatePromotion: (id: string, input: PromotionInput) => Promise<Promotion>;
  updateStatus: (id: string, status: string) => Promise<void>;
  removePromotion: (id: string) => Promise<void>;
}

export const usePromotionStore = create<PromotionState>((set, get) => ({
  items: [],
  totalCount: 0,
  totalPages: 0,
  statusCounts: null,
  loading: false,
  error: null,
  search: "",
  status: null,
  page: 1,
  pageSize: 10,

  setSearch: (search) => set({ search, page: 1 }),
  setStatus: (status) => set({ status, page: 1 }),
  setPage: (page) => set({ page }),
  setPageSize: (pageSize) => set({ pageSize, page: 1 }),

  fetchPromotions: async () => {
    const { search, status, page, pageSize } = get();
    const requestId = ++latestListRequest;
    set({ loading: true, error: null });
    try {
      const [result, statusCounts] = await Promise.all([
        promotionApi.search({ search: search || undefined, status: status || undefined, page, pageSize }),
        // The cards count the whole filtered set; a failure there must not hide the list.
        promotionApi.statusCounts({ search: search || undefined }).catch(() => null),
      ]);
      // A slower, older request finishing last must not overwrite the answer to the newer one.
      if (requestId !== latestListRequest) return;
      set({ items: result.items, totalCount: result.totalCount, totalPages: result.totalPages, statusCounts, loading: false });
    } catch (err) {
      if (requestId !== latestListRequest) return;
      set({ error: (err as Error).message, loading: false });
    }
  },

  createPromotion: async (input) => {
    const created = await promotionApi.create(input);
    await get().fetchPromotions();
    return created;
  },

  updatePromotion: async (id, input) => {
    const updated = await promotionApi.update(id, input);
    await get().fetchPromotions();
    return updated;
  },

  updateStatus: async (id, status) => {
    await promotionApi.updateStatus(id, status);
    await get().fetchPromotions();
  },

  removePromotion: async (id) => {
    const previousItems = get().items;
    const previousTotal = get().totalCount;
    set({
      items: previousItems.filter((p) => p.id !== id),
      totalCount: Math.max(0, previousTotal - 1),
    });
    try {
      await promotionApi.remove(id);
      // Refill the page and the status counts from the server rather than trusting the local guess.
      void get().fetchPromotions();
    } catch (err) {
      set({ items: previousItems, totalCount: previousTotal });
      throw err;
    }
  },
}));
