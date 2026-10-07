import { create } from 'zustand';
import { dashboardApi } from '../services/dashboardApi';
import type { DashboardSummary } from '../types/domain';

interface CatalogSummaryState {
  summary: DashboardSummary | null;
  loading: boolean;
  load: (options?: { fresh?: boolean }) => Promise<void>;
}

/**
 * The catalogue's headline totals, for the stat tiles above the list pages.
 *
 * They come from `/dashboard/summary`, which counts on the server, rather than from the rows of the
 * page currently on screen. That distinction is the whole point: this app's sibling screens once
 * showed figures counted from the current page, so "Total products" changed when you paged, and
 * fixing it was a documented piece of work. A tile that is wrong is worse than no tile.
 *
 * A failed read leaves the tiles out instead of reporting an error — the list itself is the page's
 * job, and it already says when it cannot be read. Overlapping reads share one request (the HTTP
 * layer's own cache), so three pages asking for this costs one call.
 */
export const useCatalogSummaryStore = create<CatalogSummaryState>((set) => ({
  summary: null,
  loading: false,

  load: async (options) => {
    set({ loading: true });
    try {
      set({ summary: await dashboardApi.summary(undefined, undefined, options?.fresh), loading: false });
    } catch {
      set({ loading: false });
    }
  },
}));
