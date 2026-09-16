import { create } from "zustand";
import { productApi, productTypeApi } from "../services/productApi";
import type { ProductDetail, ProductInput, ProductListItem, ProductType, SortOption } from "../types/domain";

interface ProductFilters {
  search: string;
  categoryId: string | null;
  productTypeId: string | null;
  status: string | null;
  sort: SortOption;
  page: number;
  pageSize: number;
}

interface ProductState extends ProductFilters {
  items: ProductListItem[];
  totalCount: number;
  totalPages: number;
  loading: boolean;
  error: string | null;
  productTypes: ProductType[];
  selectedProduct: ProductDetail | null;
  selectedLoading: boolean;

  setSearch: (search: string) => void;
  setCategoryId: (categoryId: string | null) => void;
  setProductTypeId: (productTypeId: string | null) => void;
  setStatus: (status: string | null) => void;
  setSort: (sort: SortOption) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  resetFilters: () => void;
  fetchProducts: () => Promise<void>;
  fetchProductTypes: () => Promise<void>;
  fetchProductById: (id: string, trackView?: boolean) => Promise<void>;
  clearSelectedProduct: () => void;
  createProduct: (input: ProductInput) => Promise<ProductDetail>;
  updateProduct: (id: string, input: ProductInput) => Promise<ProductDetail>;
  updateStatus: (id: string, status: string) => Promise<void>;
  removeProduct: (id: string) => Promise<void>;
}

let activeController: AbortController | null = null;

const defaultFilters: ProductFilters = {
  search: "",
  categoryId: null,
  productTypeId: null,
  status: null,
  sort: "recommended",
  page: 1,
  pageSize: 8,
};

export const useProductStore = create<ProductState>((set, get) => ({
  ...defaultFilters,
  items: [],
  totalCount: 0,
  totalPages: 0,
  loading: false,
  error: null,
  productTypes: [],
  selectedProduct: null,
  selectedLoading: false,

  setSearch: (search) => set({ search, page: 1 }),
  setCategoryId: (categoryId) => set({ categoryId, page: 1 }),
  setProductTypeId: (productTypeId) => set({ productTypeId, page: 1 }),
  setStatus: (status) => set({ status, page: 1 }),
  setSort: (sort) => set({ sort, page: 1 }),
  setPage: (page) => set({ page }),
  setPageSize: (pageSize) => set({ pageSize, page: 1 }),
  resetFilters: () => set({ ...defaultFilters }),

  fetchProducts: async () => {
    activeController?.abort();
    const controller = new AbortController();
    activeController = controller;

    const { search, categoryId, productTypeId, status, sort, page, pageSize } = get();
    set({ loading: true, error: null });
    try {
      const result = await productApi.search(
        {
          search: search || undefined,
          categoryId: categoryId || undefined,
          productTypeId: productTypeId || undefined,
          status: status || undefined,
          sort,
          page,
          pageSize,
        },
        controller.signal
      );
      set({ items: result.items, totalCount: result.totalCount, totalPages: result.totalPages, loading: false });
    } catch (err) {
      if ((err as Error).name === "CanceledError" || (err as Error).message === "canceled") return;
      set({ error: (err as Error).message, loading: false });
    }
  },

  fetchProductTypes: async () => {
    const productTypes = await productTypeApi.list();
    set({ productTypes });
  },

  fetchProductById: async (id, trackView = false) => {
    set({ selectedLoading: true });
    try {
      const product = await productApi.getById(id, trackView);
      set({ selectedProduct: product, selectedLoading: false });
    } catch (err) {
      set({ selectedLoading: false, error: (err as Error).message });
    }
  },

  clearSelectedProduct: () => set({ selectedProduct: null }),

  createProduct: async (input) => {
    const created = await productApi.create(input);
    await get().fetchProducts();
    return created;
  },

  updateProduct: async (id, input) => {
    const updated = await productApi.update(id, input);
    await get().fetchProducts();
    if (get().selectedProduct?.id === id) set({ selectedProduct: updated });
    return updated;
  },

  updateStatus: async (id, status) => {
    const updated = await productApi.updateStatus(id, status);
    await get().fetchProducts();
    if (get().selectedProduct?.id === id) set({ selectedProduct: updated });
  },

  removeProduct: async (id) => {
    const previousItems = get().items;
    const previousTotal = get().totalCount;
    set({
      items: previousItems.filter((p) => p.id !== id),
      totalCount: Math.max(0, previousTotal - 1),
    });
    try {
      await productApi.remove(id);
    } catch (err) {
      set({ items: previousItems, totalCount: previousTotal });
      throw err;
    }
  },
}));
