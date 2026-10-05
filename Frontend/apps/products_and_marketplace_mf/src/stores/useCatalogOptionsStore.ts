import { create } from 'zustand';
import { categoryApi } from '../services/categoryApi';
import { subCategoryApi } from '../services/subCategoryApi';
import type { Category, SubCategory } from '../types/domain';

interface CatalogOptionsState {
  /** Every category, in display order — for filters and pickers, where a page at a time would be wrong. */
  categories: Category[];
  categoriesLoaded: boolean;
  /** Sub-categories by the category they sit under, read the first time a category is chosen. */
  subCategoriesByCategory: Record<string, SubCategory[]>;
  error: string | null;

  loadCategories: (options?: { force?: boolean }) => Promise<void>;
  loadSubCategories: (categoryId: string, options?: { force?: boolean }) => Promise<void>;
  /** Forget what was read, after a category or sub-category was added, changed or removed. */
  invalidate: () => void;
}

/** The largest page the API serves; a catalogue with more categories than this would need a search box, not a list. */
const EVERYTHING = 100;

/**
 * The pickers' data: every category, and the sub-categories of whichever category was chosen.
 *
 * It is separate from the list stores because a filter or a form needs all of a category's
 * sub-categories at once, whatever page or filter the Sub-categories screen is showing.
 */
export const useCatalogOptionsStore = create<CatalogOptionsState>((set, get) => ({
  categories: [],
  categoriesLoaded: false,
  subCategoriesByCategory: {},
  error: null,

  loadCategories: async ({ force = false } = {}) => {
    if (!force && get().categoriesLoaded) return;
    try {
      const page = await categoryApi.list({ search: '', status: '', sort: 'order', page: 1, pageSize: EVERYTHING });
      set({ categories: page.items, categoriesLoaded: true, error: null });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  loadSubCategories: async (categoryId, { force = false } = {}) => {
    if (!categoryId || (!force && get().subCategoriesByCategory[categoryId])) return;
    try {
      const page = await subCategoryApi.list({ search: '', categoryId, status: '', sort: 'order', page: 1, pageSize: EVERYTHING });
      set({ subCategoriesByCategory: { ...get().subCategoriesByCategory, [categoryId]: page.items }, error: null });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  invalidate: () => set({ categories: [], categoriesLoaded: false, subCategoriesByCategory: {} }),
}));
