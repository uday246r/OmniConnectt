import { httpClient } from './httpClient';
import { cleanParams } from './query';
import type { FieldDefinitionInput, PagedResult, SubCategory, SubCategoryDetail, SubCategoryInput } from '../types/domain';

export interface SubCategoryQuery {
  search: string;
  categoryId: string;
  status: string;
  sort: string;
  page: number;
  pageSize: number;
}

export const subCategoryApi = {
  async list(query: SubCategoryQuery, signal?: AbortSignal, fresh = false): Promise<PagedResult<SubCategory>> {
    const { data } = await httpClient.get('/sub-categories', { params: cleanParams(query), signal, fresh });
    return data;
  },
  /** With the attributes its products carry — what the product form renders from. */
  async get(id: string, signal?: AbortSignal): Promise<SubCategoryDetail> {
    const { data } = await httpClient.get(`/sub-categories/${id}`, { signal });
    return data;
  },
  async create(input: SubCategoryInput): Promise<SubCategoryDetail> {
    const { data } = await httpClient.post('/sub-categories', input);
    return data;
  },
  async update(id: string, input: SubCategoryInput): Promise<SubCategoryDetail> {
    const { data } = await httpClient.put(`/sub-categories/${id}`, input);
    return data;
  },
  async reorder(id: string, direction: 'up' | 'down'): Promise<SubCategoryDetail> {
    const { data } = await httpClient.post(`/sub-categories/${id}/reorder`, { direction });
    return data;
  },
  async remove(id: string): Promise<void> {
    await httpClient.delete(`/sub-categories/${id}`);
  },

  async createField(id: string, input: FieldDefinitionInput): Promise<SubCategoryDetail> {
    const { data } = await httpClient.post(`/sub-categories/${id}/fields`, input);
    return data;
  },
  async updateField(id: string, fieldId: string, input: FieldDefinitionInput): Promise<SubCategoryDetail> {
    const { data } = await httpClient.put(`/sub-categories/${id}/fields/${fieldId}`, input);
    return data;
  },
  async removeField(id: string, fieldId: string): Promise<SubCategoryDetail> {
    const { data } = await httpClient.delete(`/sub-categories/${id}/fields/${fieldId}`);
    return data;
  },
};
