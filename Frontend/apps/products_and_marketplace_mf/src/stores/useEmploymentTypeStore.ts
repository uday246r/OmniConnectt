import { create } from "zustand";
import { employmentTypeApi } from "../services/employmentTypeApi";
import type { EmploymentType, EmploymentTypeInput } from "../types/domain";

interface EmploymentTypeState {
  items: EmploymentType[];
  loaded: boolean;
  loading: boolean;
  error: string | null;

  fetchAll: (force?: boolean) => Promise<void>;
  fetchActiveOnly: () => Promise<EmploymentType[]>;
  createEmploymentType: (input: EmploymentTypeInput) => Promise<void>;
  updateEmploymentType: (id: string, input: EmploymentTypeInput) => Promise<void>;
  removeEmploymentType: (id: string) => Promise<void>;
}

export const useEmploymentTypeStore = create<EmploymentTypeState>((set, get) => ({
  items: [],
  loaded: false,
  loading: false,
  error: null,

  fetchAll: async (force = false) => {
    if (!force && (get().loaded || get().loading)) return;
    set({ loading: true, error: null });
    try {
      const items = await employmentTypeApi.list();
      set({ items, loaded: true, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  fetchActiveOnly: async () => {
    try {
      const activeItems = await employmentTypeApi.list(true);
      return activeItems;
    } catch {
      return get().items.filter((i) => i.active);
    }
  },

  createEmploymentType: async (input) => {
    const created = await employmentTypeApi.create(input);
    set({ items: [...get().items, created].sort((a, b) => a.sortOrder - b.sortOrder) });
  },

  updateEmploymentType: async (id, input) => {
    const updated = await employmentTypeApi.update(id, input);
    set({ items: get().items.map((i) => (i.id === id ? updated : i)).sort((a, b) => a.sortOrder - b.sortOrder) });
  },

  removeEmploymentType: async (id) => {
    await employmentTypeApi.remove(id);
    set({ items: get().items.filter((i) => i.id !== id) });
  },
}));
