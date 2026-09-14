import { httpClient } from "./httpClient";
import type { Category, CategoryInput } from "../types/domain";

export const categoryApi = {
  async list(status?: string, signal?: AbortSignal): Promise<Category[]> {
    const { data } = await httpClient.get("/categories", { params: { status }, signal });
    return data;
  },
  async getById(id: string, signal?: AbortSignal): Promise<Category> {
    const { data } = await httpClient.get(`/categories/${id}`, { signal });
    return data;
  },
  async create(input: CategoryInput): Promise<Category> {
    const { data } = await httpClient.post("/categories", input);
    return data;
  },
  async update(id: string, input: CategoryInput): Promise<Category> {
    const { data } = await httpClient.put(`/categories/${id}`, input);
    return data;
  },
  async reorder(id: string, direction: "up" | "down"): Promise<Category> {
    const { data } = await httpClient.post(`/categories/${id}/reorder`, { direction });
    return data;
  },
  async remove(id: string): Promise<void> {
    await httpClient.delete(`/categories/${id}`);
  },
};
