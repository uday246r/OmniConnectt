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

/** Options every read here accepts. `fresh` bypasses the read cache — the Refresh button sets it. */
export interface AuditLogReadOptions {
  signal?: AbortSignal;
  fresh?: boolean;
}

export const auditLogApi = {
  async search(query: AuditLogQuery, options: AuditLogReadOptions = {}): Promise<PagedResult<AuditLog>> {
    const { data } = await httpClient.get("/audit-logs", { params: query, ...options });
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
  async getSummary(query: AuditLogQuery, options: AuditLogReadOptions = {}): Promise<AuditLogSummary> {
    const { data } = await httpClient.get("/audit-logs/summary", { params: query, ...options });
    return data;
  },
  async getEntityTypes(signal?: AbortSignal): Promise<string[]> {
    const { data } = await httpClient.get("/audit-logs/entity-types", { signal });
    return data;
  },
};
