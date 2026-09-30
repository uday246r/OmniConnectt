import { create } from 'zustand';
import { dashboardApi } from '../services/dashboardApi';
import type { CatalogBreakdown, DashboardSummary, RecentActivity, RecentProduct, StatusDistribution } from '../types/domain';

interface DashboardState {
  summary: DashboardSummary | null;
  /** Products per category — or per sub-category of `breakdownCategoryId` once one is chosen. */
  breakdown: CatalogBreakdown[];
  breakdownCategoryId: string;
  distribution: StatusDistribution[];
  recentProducts: RecentProduct[];
  recentActivity: RecentActivity[];
  loading: boolean;
  loaded: boolean;
  error: string | null;

  load: () => Promise<void>;
  setBreakdownCategory: (categoryId: string) => Promise<void>;
}

/**
 * Everything on the dashboard, read together.
 *
 * The panels are independent — one failing must not blank the rest — so they are read side by side and
 * each keeps whatever arrived. The page reports an error only when nothing did.
 */
export const useDashboardStore = create<DashboardState>((set, get) => ({
  summary: null,
  breakdown: [],
  breakdownCategoryId: '',
  distribution: [],
  recentProducts: [],
  recentActivity: [],
  loading: false,
  loaded: false,
  error: null,

  load: async () => {
    set({ loading: true, error: null });
    const categoryId = get().breakdownCategoryId || undefined;
    const results = await Promise.allSettled([
      dashboardApi.summary(),
      dashboardApi.productBreakdown(categoryId),
      dashboardApi.statusDistribution(),
      dashboardApi.recentProducts(),
      dashboardApi.recentActivity(),
    ]);
    const [summary, breakdown, distribution, recentProducts, recentActivity] = results;
    const failed = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');

    set({
      summary: summary.status === 'fulfilled' ? summary.value : get().summary,
      breakdown: breakdown.status === 'fulfilled' ? breakdown.value : get().breakdown,
      distribution: distribution.status === 'fulfilled' ? distribution.value : get().distribution,
      recentProducts: recentProducts.status === 'fulfilled' ? recentProducts.value : get().recentProducts,
      recentActivity: recentActivity.status === 'fulfilled' ? recentActivity.value : get().recentActivity,
      loading: false,
      loaded: true,
      error: failed.length === results.length ? ((failed[0].reason as Error)?.message ?? 'The dashboard could not be loaded.') : null,
    });
  },

  setBreakdownCategory: async (categoryId) => {
    set({ breakdownCategoryId: categoryId });
    try {
      set({ breakdown: await dashboardApi.productBreakdown(categoryId || undefined) });
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },
}));
