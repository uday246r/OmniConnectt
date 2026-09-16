import { create } from "zustand";
import { dashboardApi } from "../services/dashboardApi";
import type {
  CategoryBreakdown,
  DashboardSummary,
  RecentProduct,
  StatusDistribution,
  TopProduct,
  TopSearch,
  TrendPoint,
} from "../types/domain";

interface DashboardState {
  summary: DashboardSummary | null;
  trend: TrendPoint[];
  trendDays: number;
  trendLoading: boolean;
  categoryBreakdown: CategoryBreakdown[];
  statusDistribution: StatusDistribution[];
  topProducts: TopProduct[];
  recentProducts: RecentProduct[];
  topSearches: TopSearch[];
  loading: boolean;
  error: string | null;
  fetchAll: () => Promise<void>;
  setTrendDays: (days: number) => Promise<void>;
}

export const useDashboardStore = create<DashboardState>((set, get) => ({
  summary: null,
  trend: [],
  trendDays: 7,
  trendLoading: false,
  categoryBreakdown: [],
  statusDistribution: [],
  topProducts: [],
  recentProducts: [],
  topSearches: [],
  loading: false,
  error: null,

  fetchAll: async () => {
    set({ loading: true, error: null });
    try {
      const [summary, trend, categoryBreakdown, statusDistribution, topProducts, recentProducts, topSearches] =
        await Promise.all([
          dashboardApi.summary(),
          dashboardApi.applicationTrends(get().trendDays),
          dashboardApi.applicationsByCategory(),
          dashboardApi.productStatusDistribution(),
          dashboardApi.topProducts(5),
          dashboardApi.recentProducts(5),
          dashboardApi.topSearches(5),
        ]);
      set({
        summary,
        trend,
        categoryBreakdown,
        statusDistribution,
        topProducts,
        recentProducts,
        topSearches,
        loading: false,
      });
    } catch (err) {
      set({ error: (err as Error).message, loading: false });
    }
  },

  setTrendDays: async (days) => {
    set({ trendDays: days, trendLoading: true });
    try {
      const trend = await dashboardApi.applicationTrends(days);
      set({ trend, trendLoading: false });
    } catch (err) {
      set({ error: (err as Error).message, trendLoading: false });
    }
  },
}));
