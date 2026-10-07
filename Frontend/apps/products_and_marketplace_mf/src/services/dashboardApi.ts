import { httpClient } from './httpClient';
import { cleanParams } from './query';
import type { CatalogBreakdown, DashboardSummary, RecentActivity, RecentProduct, StatusDistribution } from '../types/domain';

export const dashboardApi = {
  /** `fresh` asks the server rather than accepting the briefly-cached answer — for a Refresh button. */
  async summary(days?: number, signal?: AbortSignal, fresh = false): Promise<DashboardSummary> {
    const { data } = await httpClient.get('/dashboard/summary', { params: cleanParams({ days }), signal, fresh });
    return data;
  },
  /** Products per category; or per sub-category of `categoryId` when one is given. */
  async productBreakdown(categoryId?: string, signal?: AbortSignal): Promise<CatalogBreakdown[]> {
    const { data } = await httpClient.get('/dashboard/product-breakdown', { params: cleanParams({ categoryId }), signal });
    return data;
  },
  async statusDistribution(signal?: AbortSignal): Promise<StatusDistribution[]> {
    const { data } = await httpClient.get('/dashboard/product-status-distribution', { signal });
    return data;
  },
  async recentProducts(take?: number, signal?: AbortSignal): Promise<RecentProduct[]> {
    const { data } = await httpClient.get('/dashboard/recent-products', { params: cleanParams({ take }), signal });
    return data;
  },
  async recentActivity(take?: number, signal?: AbortSignal): Promise<RecentActivity[]> {
    const { data } = await httpClient.get('/dashboard/recent-activity', { params: cleanParams({ take }), signal });
    return data;
  },
};
