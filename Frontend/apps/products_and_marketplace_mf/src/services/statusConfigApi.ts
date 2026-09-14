import { httpClient } from "./httpClient";
import type { StatusConfig, StatusConfigCreateInput, StatusConfigInput, StatusEntityType } from "../types/domain";

export const statusConfigApi = {
  async list(entityType?: StatusEntityType, signal?: AbortSignal): Promise<StatusConfig[]> {
    const { data } = await httpClient.get("/status-configs", { params: { entityType }, signal });
    return data;
  },
  async create(input: StatusConfigCreateInput): Promise<StatusConfig> {
    const { data } = await httpClient.post("/status-configs", input);
    return data;
  },
  async update(id: string, input: StatusConfigInput): Promise<StatusConfig> {
    const { data } = await httpClient.put(`/status-configs/${id}`, input);
    return data;
  },
  async remove(id: string): Promise<void> {
    await httpClient.delete(`/status-configs/${id}`);
  },
};

