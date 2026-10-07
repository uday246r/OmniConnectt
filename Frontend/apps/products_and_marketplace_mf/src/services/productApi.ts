import { httpClient } from './httpClient';
import { cleanParams } from './query';
import type { PagedResult, ProductDetail, ProductInput, ProductListItem, StatusCount } from '../types/domain';

export interface ProductQuery {
  search: string;
  categoryId: string;
  subCategoryId: string;
  status: string;
  sort: string;
  page: number;
  pageSize: number;
}

/** What identifies the same set of products regardless of paging — the query minus page and page size. */
export type ProductFilters = Omit<ProductQuery, 'page' | 'pageSize'>;

export const productApi = {
  async list(query: ProductQuery, signal?: AbortSignal, fresh = false): Promise<PagedResult<ProductListItem>> {
    const { data } = await httpClient.get('/products', { params: cleanParams(query), signal, fresh });
    return data;
  },
  /** Products per status under the other filters; the status filter itself is ignored. */
  async statusCounts(filters: ProductFilters, signal?: AbortSignal): Promise<StatusCount[]> {
    const { data } = await httpClient.get('/products/status-counts', { params: cleanParams(filters), signal });
    return data;
  },
  async get(id: string, options: { trackView?: boolean } = {}, signal?: AbortSignal): Promise<ProductDetail> {
    const { data } = await httpClient.get(`/products/${id}`, {
      params: cleanParams({ trackView: options.trackView ? true : undefined }),
      signal,
    });
    return data;
  },
  async create(input: ProductInput): Promise<ProductDetail> {
    const { data } = await httpClient.post('/products', input);
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
};
