import { httpClient } from "./httpClient";
import type { PagedResult, Promotion, PromotionInput, StatusCount } from "../types/domain";

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
  /** Promotions per status under the search/product filters (the status filter is ignored by the server). */
  async statusCounts(query: Pick<PromotionQuery, "search" | "productId">, signal?: AbortSignal): Promise<StatusCount[]> {
    const { data } = await httpClient.get("/promotions/status-counts", { params: query, signal });
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
