import { httpClient } from './httpClient';
import { cleanParams } from './query';
import type { Category, CategoryInput, PagedResult } from '../types/domain';

export interface CategoryQuery {
  search: string;
  status: string;
  sort: string;
  page: number;
  pageSize: number;
}

export const categoryApi = {
  async list(query: CategoryQuery, signal?: AbortSignal, fresh = false): Promise<PagedResult<Category>> {
    const { data } = await httpClient.get('/categories', { params: cleanParams(query), signal, fresh });
    return data;
  },
  async get(id: string): Promise<Category> {
    const { data } = await httpClient.get(`/categories/${id}`);
    return data;
  },
  async create(input: CategoryInput): Promise<Category> {
    const { data } = await httpClient.post('/categories', input);
    return data;
  },
  async update(id: string, input: CategoryInput): Promise<Category> {
    const { data } = await httpClient.put(`/categories/${id}`, input);
    return data;
  },
  async reorder(id: string, direction: 'up' | 'down'): Promise<Category> {
    const { data } = await httpClient.post(`/categories/${id}/reorder`, { direction });
    return data;
  },
  async remove(id: string): Promise<void> {
    await httpClient.delete(`/categories/${id}`);
  },
};
