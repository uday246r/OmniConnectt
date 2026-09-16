import { httpClient } from "./httpClient";
import type {
  FieldDefinitionInput,
  PagedResult,
  ProductDetail,
  ProductInput,
  ProductListItem,
  ProductType,
  ProductTypeInput,
  SortOption,
  TopPerformer,
} from "../types/domain";

export interface ProductQuery {
  search?: string;
  categoryId?: string;
  productTypeId?: string;
  status?: string;
  minRating?: number;
  sort?: SortOption;
  page?: number;
  pageSize?: number;
}

export const productApi = {
  async search(query: ProductQuery, signal?: AbortSignal): Promise<PagedResult<ProductListItem>> {
    const { data } = await httpClient.get("/products", { params: query, signal });
    return data;
  },
  async getById(id: string, trackView = false, signal?: AbortSignal): Promise<ProductDetail> {
    const { data } = await httpClient.get(`/products/${id}`, { params: { trackView }, signal });
    return data;
  },
  async create(input: ProductInput): Promise<ProductDetail> {
    const { data } = await httpClient.post("/products", input);
    return data;
  },
  async update(id: string, input: ProductInput): Promise<ProductDetail> {
    const { data } = await httpClient.put(`/products/${id}`, input);
    return data;
  },
  async updateStatus(id: string, status: string): Promise<ProductDetail> {
    const { data } = await httpClient.patch(`/products/${id}/status`, { status });
    return data;
  },
  async remove(id: string): Promise<void> {
    await httpClient.delete(`/products/${id}`);
  },
  async topPerformers(metric: "applied" | "viewed" | "rated", take = 5, signal?: AbortSignal): Promise<TopPerformer[]> {
    const { data } = await httpClient.get("/products/top-performers", { params: { metric, take }, signal });
    return data;
  },
};

export const productTypeApi = {
  async list(signal?: AbortSignal): Promise<ProductType[]> {
    const { data } = await httpClient.get("/product-types", { signal });
    return data;
  },
  async getById(id: string, signal?: AbortSignal): Promise<ProductType> {
    const { data } = await httpClient.get(`/product-types/${id}`, { signal });
    return data;
  },
  async create(input: ProductTypeInput): Promise<ProductType> {
    const { data } = await httpClient.post("/product-types", input);
    return data;
  },
  async update(id: string, input: ProductTypeInput): Promise<ProductType> {
    const { data } = await httpClient.put(`/product-types/${id}`, input);
    return data;
  },
  async remove(id: string): Promise<void> {
    await httpClient.delete(`/product-types/${id}`);
  },
  async createField(productTypeId: string, input: FieldDefinitionInput): Promise<ProductType> {
    const { data } = await httpClient.post(`/product-types/${productTypeId}/fields`, input);
    return data;
  },
  async updateField(productTypeId: string, fieldId: string, input: FieldDefinitionInput): Promise<ProductType> {
    const { data } = await httpClient.put(`/product-types/${productTypeId}/fields/${fieldId}`, input);
    return data;
  },
  async removeField(productTypeId: string, fieldId: string): Promise<ProductType> {
    const { data } = await httpClient.delete(`/product-types/${productTypeId}/fields/${fieldId}`);
    return data;
  },
};
