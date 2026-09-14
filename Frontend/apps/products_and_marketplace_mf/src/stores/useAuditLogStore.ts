import { create } from "zustand";
import { auditLogApi } from "../services/auditLogApi";
import type { AuditActionOption, AuditLog, AuditLogSummary } from "../types/domain";

interface AuditLogState {
  items: AuditLog[];
  totalCount: number;
  totalPages: number;
  loading: boolean;
  error: string | null;
  search: string;
  action: string | null;
  entityType: string | null;
  page: number;
  pageSize: number;
  actionOptions: AuditActionOption[];
  entityTypeOptions: string[];
  summary: AuditLogSummary | null;
  liveCount: number;

  setSearch: (search: string) => void;
  setAction: (action: string | null) => void;
  setEntityType: (entityType: string | null) => void;
  setPage: (page: number) => void;
  setPageSize: (pageSize: number) => void;
  fetchAuditLogs: () => Promise<void>;
  fetchActionOptions: () => Promise<void>;
  fetchEntityTypes: () => Promise<void>;
  ingestLiveEntry: (entry: AuditLog) => void;
}

export const useAuditLogStore = create<AuditLogState>((set, get) => ({
  items: [],
  totalCount: 0,
  totalPages: 0,
  loading: false,
  error: null,
  search: "",
  action: null,
  entityType: null,
  page: 1,
  pageSize: 10,
  actionOptions: [],
  entityTypeOptions: [],
  summary: null,
  liveCount: 0,

  setSearch: (search) => set({ search, page: 1 }),
  setAction: (action) => set({ action, page: 1 }),
  setEntityType: (entityType) => set({ entityType, page: 1 }),
  setPage: (page) => set({ page }),
  setPageSize: (pageSize) => set({ pageSize, page: 1 }),

  fetchAuditLogs: async () => {
    const { search, action, entityType, page, pageSize } = get();
    set({ loading: true, error: null });
    const filters = {
      search: search || undefined,
      action: action || undefined,
      entityType: entityType || undefined,
    };
    try {
      // The page of rows and the headline figures are fetched with the same filters, so the KPIs
      // describe the whole matching result set rather than just the rows currently rendered.
      const [result, summary] = await Promise.all([
        auditLogApi.search({ ...filters, page, pageSize }),
        auditLogApi.getSummary(filters),
      ]);
      set({
        items: result.items,
        totalCount: result.totalCount,
        totalPages: result.totalPages,
        summary,
        loading: false,
        liveCount: 0,
      });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  fetchActionOptions: async () => {
    const actionOptions = await auditLogApi.getActionOptions();
    set({ actionOptions });
  },

  fetchEntityTypes: async () => {
    const entityTypeOptions = await auditLogApi.getEntityTypes();
    set({ entityTypeOptions });
  },

  /** Called when a new entry arrives over the real-time feed. On page 1 with no active filters it is
   * prepended immediately; otherwise we just bump a "N new" indicator so the list isn't yanked out
   * from under an admin who is mid-filter/mid-read. */
  ingestLiveEntry: (entry) => {
    const { page, search, action, entityType, items, summary } = get();
    const noFilters = !search && !action && !entityType;
    if (page === 1 && noFilters) {
      // Keep the headline figures in step with the row that was just prepended, so they don't drift
      // from the table until the next refetch.
      const nextSummary: AuditLogSummary | null = summary && {
        ...summary,
        totalCount: summary.totalCount + 1,
        successCount: summary.successCount + (entry.success ? 1 : 0),
        failureCount: summary.failureCount + (entry.success ? 0 : 1),
        successRate:
          Math.round(((summary.successCount + (entry.success ? 1 : 0)) / (summary.totalCount + 1)) * 1000) / 10,
      };
      set({
        items: [entry, ...items].slice(0, get().pageSize),
        totalCount: get().totalCount + 1,
        summary: nextSummary,
      });
    } else {
      set({ liveCount: get().liveCount + 1 });
    }
  },
}));
