import { create } from "zustand";
import { promotionApi } from "../services/promotionApi";
import type { Promotion, PromotionInput } from "../types/domain";

interface PromotionState {
  items: Promotion[];
  totalCount: number;
  totalPages: number;
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
    set({ loading: true, error: null });
    try {
      const result = await promotionApi.search({ search: search || undefined, status: status || undefined, page, pageSize });
      set({ items: result.items, totalCount: result.totalCount, totalPages: result.totalPages, loading: false });
    } catch (err) {
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
    } catch (err) {
      set({ items: previousItems, totalCount: previousTotal });
      throw err;
    }
  },
}));
