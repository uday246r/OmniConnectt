import { create } from "zustand";
import { categoryApi } from "../services/categoryApi";
import type { Category, CategoryInput } from "../types/domain";

interface CategoryState {
  categories: Category[];
  loading: boolean;
  error: string | null;
  statusFilter: string;
  searchTerm: string;
  setStatusFilter: (status: string) => void;
  setSearchTerm: (term: string) => void;
  fetchAll: () => Promise<void>;
  createCategory: (input: CategoryInput) => Promise<Category>;
  updateCategory: (id: string, input: CategoryInput) => Promise<Category>;
  reorder: (id: string, direction: "up" | "down") => Promise<void>;
  removeCategory: (id: string) => Promise<void>;
}

export const useCategoryStore = create<CategoryState>((set, get) => ({
  categories: [],
  loading: false,
  error: null,
  statusFilter: "",
  searchTerm: "",

  setStatusFilter: (status) => set({ statusFilter: status }),
  setSearchTerm: (term) => set({ searchTerm: term }),

  fetchAll: async () => {
    // Only set loading on initial fetch to avoid flickering on filter or update
    if (get().categories.length === 0) {
      set({ loading: true, error: null });
    }
    try {
      const categories = await categoryApi.list(get().statusFilter || undefined);
      set({ categories, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  createCategory: async (input) => {
    const created = await categoryApi.create(input);
    const categories = await categoryApi.list(get().statusFilter || undefined);
    set({ categories });
    return created;
  },

  updateCategory: async (id, input) => {
    const updated = await categoryApi.update(id, input);
    const categories = await categoryApi.list(get().statusFilter || undefined);
    set({ categories });
    return updated;
  },

  reorder: async (id, direction) => {
    await categoryApi.reorder(id, direction);
    const categories = await categoryApi.list(get().statusFilter || undefined);
    set({ categories });
  },

  removeCategory: async (id) => {
    const previousCategories = get().categories;
    set({ categories: previousCategories.filter((c) => c.id !== id) });
    try {
      await categoryApi.remove(id);
    } catch (err) {
      set({ categories: previousCategories });
      throw err;
    }
  },
}));
