import { httpClient } from "./httpClient";
import type { AuditActionOption, AuditLog, AuditLogSummary, PagedResult } from "../types/domain";

export interface AuditLogQuery {
  search?: string;
  action?: string;
  entityType?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export const auditLogApi = {
  async search(query: AuditLogQuery, signal?: AbortSignal): Promise<PagedResult<AuditLog>> {
    const { data } = await httpClient.get("/audit-logs", { params: query, signal });
    return data;
  },
  async getById(id: string, signal?: AbortSignal): Promise<AuditLog> {
    const { data } = await httpClient.get(`/audit-logs/${id}`, { signal });
    return data;
  },
  async getActionOptions(signal?: AbortSignal): Promise<AuditActionOption[]> {
    const { data } = await httpClient.get("/audit-logs/actions", { signal });
    return data;
  },
  /** Aggregates over every row matching the filters, not just the page on screen. */
  async getSummary(query: AuditLogQuery, signal?: AbortSignal): Promise<AuditLogSummary> {
    const { data } = await httpClient.get("/audit-logs/summary", { params: query, signal });
    return data;
  },
  async getEntityTypes(signal?: AbortSignal): Promise<string[]> {
    const { data } = await httpClient.get("/audit-logs/entity-types", { signal });
    return data;
  },
};
