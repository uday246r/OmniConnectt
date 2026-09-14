import { httpClient } from "./httpClient";
import type { EmploymentType, EmploymentTypeInput } from "../types/domain";

export const employmentTypeApi = {
  async list(activeOnly?: boolean, signal?: AbortSignal): Promise<EmploymentType[]> {
    const { data } = await httpClient.get("/employment-types", { params: { activeOnly }, signal });
    return data;
  },
  async getById(id: string, signal?: AbortSignal): Promise<EmploymentType> {
    const { data } = await httpClient.get(`/employment-types/${id}`, { signal });
    return data;
  },
  async create(input: EmploymentTypeInput): Promise<EmploymentType> {
    const { data } = await httpClient.post("/employment-types", input);
    return data;
  },
  async update(id: string, input: EmploymentTypeInput): Promise<EmploymentType> {
    const { data } = await httpClient.put(`/employment-types/${id}`, input);
    return data;
  },
  async remove(id: string): Promise<void> {
    await httpClient.delete(`/employment-types/${id}`);
  },
};
