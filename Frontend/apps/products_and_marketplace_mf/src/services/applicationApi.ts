import { httpClient, API_BASE_URL } from "./httpClient";
import type { ApplicationDetail, ApplicationDocument, ApplicationInput, ApplicationListItem, PagedResult, StatusCount } from "../types/domain";

export interface ApplicationQuery {
  search?: string;
  productId?: string;
  status?: string;
  page?: number;
  pageSize?: number;
}

export const applicationApi = {
  async search(query: ApplicationQuery, signal?: AbortSignal): Promise<PagedResult<ApplicationListItem>> {
    const { data } = await httpClient.get("/applications", { params: query, signal });
    return data;
  },
  /** Applications per status under the search/product filters (the status filter is ignored by the server). */
  async statusCounts(query: Pick<ApplicationQuery, "search" | "productId">, signal?: AbortSignal): Promise<StatusCount[]> {
    const { data } = await httpClient.get("/applications/status-counts", { params: query, signal });
    return data;
  },
  async getById(id: string, signal?: AbortSignal): Promise<ApplicationDetail> {
    const { data } = await httpClient.get(`/applications/${id}`, { signal });
    return data;
  },
  async create(input: ApplicationInput): Promise<ApplicationDetail> {
    const { data } = await httpClient.post("/applications", input);
    return data;
  },
  async updateStatus(id: string, status: string, note?: string): Promise<ApplicationDetail> {
    const { data } = await httpClient.put(`/applications/${id}/status`, { status, note });
    return data;
  },
  async uploadDocument(applicationId: string, documentId: string, file: File): Promise<ApplicationDocument> {
    const formData = new FormData();
    formData.append("file", file);
    const { data } = await httpClient.post(`/applications/${applicationId}/documents/${documentId}/upload`, formData, {
      headers: { "Content-Type": "multipart/form-data" },
    });
    return data;
  },
  async removeDocumentFile(applicationId: string, documentId: string): Promise<ApplicationDocument> {
    const { data } = await httpClient.delete(`/applications/${applicationId}/documents/${documentId}/file`);
    return data;
  },
  getDocumentFileUrl(applicationId: string, documentId: string): string {
    return `${API_BASE_URL}/applications/${applicationId}/documents/${documentId}/file`;
  },
};
