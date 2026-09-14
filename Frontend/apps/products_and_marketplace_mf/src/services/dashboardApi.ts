import { httpClient } from "./httpClient";
import type {
  CategoryBreakdown,
  DashboardSummary,
  RecentProduct,
  StatusDistribution,
  TopProduct,
  TopSearch,
  TrendPoint,
} from "../types/domain";

export const dashboardApi = {
  async summary(signal?: AbortSignal): Promise<DashboardSummary> {
    const { data } = await httpClient.get("/dashboard/summary", { signal });
    return data;
  },
  async applicationTrends(days = 7, signal?: AbortSignal): Promise<TrendPoint[]> {
    const { data } = await httpClient.get("/dashboard/application-trends", { params: { days }, signal });
    return data;
  },
  async applicationsByCategory(signal?: AbortSignal): Promise<CategoryBreakdown[]> {
    const { data } = await httpClient.get("/dashboard/applications-by-category", { signal });
    return data;
  },
  async productStatusDistribution(signal?: AbortSignal): Promise<StatusDistribution[]> {
    const { data } = await httpClient.get("/dashboard/product-status-distribution", { signal });
    return data;
  },
  async topProducts(take = 5, signal?: AbortSignal): Promise<TopProduct[]> {
    const { data } = await httpClient.get("/dashboard/top-products", { params: { take }, signal });
    return data;
  },
  async recentProducts(take = 5, signal?: AbortSignal): Promise<RecentProduct[]> {
    const { data } = await httpClient.get("/dashboard/recent-products", { params: { take }, signal });
    return data;
  },
  async topSearches(take = 5, signal?: AbortSignal): Promise<TopSearch[]> {
    const { data } = await httpClient.get("/dashboard/top-searches", { params: { take }, signal });
    return data;
  },
};
