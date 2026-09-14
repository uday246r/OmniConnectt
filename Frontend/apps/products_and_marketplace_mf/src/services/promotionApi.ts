import { httpClient } from "./httpClient";
import type { PagedResult, Promotion, PromotionInput } from "../types/domain";

export interface PromotionQuery {
  search?: string;
  productId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export const promotionApi = {
  async search(query: PromotionQuery, signal?: AbortSignal): Promise<PagedResult<Promotion>> {
    const { data } = await httpClient.get("/promotions", { params: query, signal });
    return data;
  },
  async create(input: PromotionInput): Promise<Promotion> {
    const { data } = await httpClient.post("/promotions", input);
    return data;
  },
  async update(id: string, input: PromotionInput): Promise<Promotion> {
    const { data } = await httpClient.put(`/promotions/${id}`, input);
    return data;
  },
  async updateStatus(id: string, status: string): Promise<Promotion> {
    const { data } = await httpClient.patch(`/promotions/${id}/status`, { status });
    return data;
  },
  async remove(id: string): Promise<void> {
    await httpClient.delete(`/promotions/${id}`);
  },
};
