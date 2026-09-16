import { create } from "zustand";
import { productTypeApi } from "../services/productApi";
import { documentDefinitionApi } from "../services/documentDefinitionApi";
import { useProductStore } from "./useProductStore";
import type { DocumentDefinition, DocumentDefinitionInput, FieldDefinitionInput, ProductType, ProductTypeInput } from "../types/domain";

interface SetupState {
  productTypes: ProductType[];
  documentDefinitions: DocumentDefinition[];
  loading: boolean;
  error: string | null;
  selectedProductTypeId: string | null;

  fetchProductTypes: () => Promise<void>;
  fetchDocumentDefinitions: () => Promise<void>;
  selectProductType: (id: string | null) => void;

  createProductType: (input: ProductTypeInput) => Promise<ProductType>;
  updateProductType: (id: string, input: ProductTypeInput) => Promise<ProductType>;
  removeProductType: (id: string) => Promise<void>;

  createField: (productTypeId: string, input: FieldDefinitionInput) => Promise<void>;
  updateField: (productTypeId: string, fieldId: string, input: FieldDefinitionInput) => Promise<void>;
  removeField: (productTypeId: string, fieldId: string) => Promise<void>;

  createDocumentDefinition: (input: DocumentDefinitionInput) => Promise<DocumentDefinition>;
  updateDocumentDefinition: (id: string, input: DocumentDefinitionInput) => Promise<DocumentDefinition>;
  removeDocumentDefinition: (id: string) => Promise<void>;
}

export const useSetupStore = create<SetupState>((set, get) => ({
  productTypes: [],
  documentDefinitions: [],
  loading: false,
  error: null,
  selectedProductTypeId: null,

  fetchProductTypes: async () => {
    set({ loading: true, error: null });
    try {
      const productTypes = await productTypeApi.list();
      set({ productTypes, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  fetchDocumentDefinitions: async () => {
    set({ loading: true, error: null });
    try {
      const documentDefinitions = await documentDefinitionApi.list();
      set({ documentDefinitions, loading: false });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  selectProductType: (id) => set({ selectedProductTypeId: id }),

  createProductType: async (input) => {
    const created = await productTypeApi.create(input);
    await get().fetchProductTypes();
    useProductStore.getState().fetchProductTypes();
    return created;
  },

  updateProductType: async (id, input) => {
    const updated = await productTypeApi.update(id, input);
    await get().fetchProductTypes();
    useProductStore.getState().fetchProductTypes();
    return updated;
  },

  removeProductType: async (id) => {
    await productTypeApi.remove(id);
    if (get().selectedProductTypeId === id) set({ selectedProductTypeId: null });
    await get().fetchProductTypes();
    useProductStore.getState().fetchProductTypes();
  },

  createField: async (productTypeId, input) => {
    await productTypeApi.createField(productTypeId, input);
    await get().fetchProductTypes();
    useProductStore.getState().fetchProductTypes();
  },

  updateField: async (productTypeId, fieldId, input) => {
    await productTypeApi.updateField(productTypeId, fieldId, input);
    await get().fetchProductTypes();
    useProductStore.getState().fetchProductTypes();
  },

  removeField: async (productTypeId, fieldId) => {
    await productTypeApi.removeField(productTypeId, fieldId);
    await get().fetchProductTypes();
    useProductStore.getState().fetchProductTypes();
  },

  createDocumentDefinition: async (input) => {
    const created = await documentDefinitionApi.create(input);
    await get().fetchDocumentDefinitions();
    return created;
  },

  updateDocumentDefinition: async (id, input) => {
    const updated = await documentDefinitionApi.update(id, input);
    await get().fetchDocumentDefinitions();
    return updated;
  },

  removeDocumentDefinition: async (id) => {
    await documentDefinitionApi.remove(id);
    await get().fetchDocumentDefinitions();
  },
}));
