import { useEffect } from "react";
import { Icon, type IconName } from "../components/common/Icon";
import { KpiCard } from "../components/common/KpiCard";
import { LineChart } from "../components/charts/LineChart";
import { DonutChart, DonutLegend } from "../components/charts/DonutChart";
import { StatusBadge, formatStatusLabel } from "../components/common/StatusBadge";
import { formatRelativeTime } from "../utils/fieldFormat";
import { useDashboardStore } from "../stores/useDashboardStore";
import { useDrawerStore } from "../stores/useDrawerStore";
import { usePermissions } from "../permissions/PermissionContext";
import { PERMISSIONS } from "../permissions/permissions";
import { ErrorState } from "../components/common/EmptyState";
import "./DashboardPage.css";

const TREND_OPTIONS = [
  { value: 7, label: "This Week" },
  { value: 30, label: "Last 30 Days" },
  { value: 90, label: "Last 90 Days" },
];

function formatRangeLabel(start?: string, end?: string): string {
  if (!start || !end) return "";
  const fmt = (d: string) => new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
  return `${fmt(start)} - ${fmt(end)}`;
}

export function DashboardPage() {
  const {
    summary, trend, trendDays, trendLoading, categoryBreakdown, statusDistribution, topProducts,
    recentProducts, topSearches, loading, error, fetchAll, setTrendDays,
  } = useDashboardStore();
  const openDrawer = useDrawerStore((s) => s.open);
  const { has } = usePermissions();
  const canCreateProduct = has(PERMISSIONS.PRODUCTS_CREATE);

  useEffect(() => {
    fetchAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (error) return <ErrorState message={error} onRetry={fetchAll} />;

  const statusTotal = statusDistribution.reduce((a, s) => a + s.count, 0);
  const categoryTotal = categoryBreakdown.reduce((a, s) => a + s.count, 0);
  const maxSearchCount = Math.max(...topSearches.map((s) => s.count), 1);
  const topCategory = categoryBreakdown[0];
  const topProduct = topProducts[0];
  const topSearch = topSearches[0];

  return (
    <div className="pm-page">
      {/* Lead Management Style Hero Welcome Banner */}
      <div className="pm-hero-banner">
        {/* Background decorative circles */}
        <div className="pm-hero-circle-1" />
        <div className="pm-hero-circle-2" />

        {/* Left Side: Frosted Icon & Header Text */}
        <div className="pm-hero-left">
          <div className="pm-hero-icon-wrap">
            <Icon name="package" size={24} />
          </div>
          <div className="pm-hero-text">
            <div className="pm-hero-title-row">
              <h1 className="pm-hero-title">Product Marketplace Overview</h1>
              <span className="pm-hero-live-badge">
                <span className="pm-hero-live-dot" /> Live
              </span>
            </div>
            <p className="pm-hero-subtitle">Real-time marketplace performance, product catalogs &amp; application insights</p>
          </div>
        </div>

        {/* Right Side: Quick Action & Date Pill */}
        <div className="pm-hero-right">
          {canCreateProduct && (
            <button
              type="button"
              className="pm-hero-btn"
              onClick={() => openDrawer("product-form")}
            >
              <Icon name="plus" size={15} />
              <span>Add Product</span>
            </button>
          )}

          {summary && (
            <div className="pm-hero-date-chip">
              <Icon name="calendar" size={14} />
              <span>{formatRangeLabel(summary.rangeStart, summary.rangeEnd)}</span>
            </div>
          )}
        </div>
      </div>


      {loading || !summary ? (
        <div className="pm-kpi-grid">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="pm-card pm-skeleton" style={{ height: 110 }} />
          ))}
        </div>
      ) : (
        <div className="pm-kpi-grid">
          <KpiCard kpi={summary.totalProducts} icon="package" tone="blue" subtitle="Platform-wise" />
          <KpiCard kpi={summary.activeProducts} icon="check" tone="green" subtitle="Active catalog" />
          <KpiCard kpi={summary.totalApplications} icon="file" tone="amber" subtitle="All applications" />
          <KpiCard kpi={summary.totalViews} icon="eye" tone="purple" subtitle="Customer views" />
          <KpiCard kpi={summary.conversionRate} icon="trending-up" tone="rose" subtitle="Approval rate" />
        </div>
      )}

      <div className="pm-dashboard-grid">
        <div className="pm-dashboard-panel">
          <div className="pm-panel-head">
            <div>
              <h3 className="pm-panel-title">Applications Overview</h3>
              <p className="pm-panel-subtitle">Application submission volume trend over time</p>
            </div>
            <select className="pm-select pm-select-sm" value={trendDays} onChange={(e) => setTrendDays(Number(e.target.value))}>
              {TREND_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          {trendLoading ? <div className="pm-skeleton" style={{ height: 220 }} /> : trend.length > 0 && <LineChart points={trend.map((t) => ({ label: t.label, value: t.value }))} />}
        </div>

        <div className="pm-dashboard-panel">
          <div className="pm-panel-head">
            <div>
              <h3 className="pm-panel-title">Applications by Category</h3>
              <p className="pm-panel-subtitle">Distribution of applications by product category</p>
            </div>
          </div>
          <div className="pm-donut-row">
            <DonutChart segments={categoryBreakdown.map((c) => ({ label: c.categoryName, value: c.count, percentage: c.percentage }))} total={categoryTotal} centerLabel="Total" />
            <DonutLegend segments={categoryBreakdown.map((c) => ({ label: c.categoryName, value: c.count, percentage: c.percentage }))} />
          </div>
        </div>

        <div className="pm-dashboard-panel">
          <div className="pm-panel-head">
            <div>
              <h3 className="pm-panel-title">Top Performing Products</h3>
              <p className="pm-panel-subtitle">Highest volume products by submitted applications</p>
            </div>
          </div>
          <ul className="pm-ranked-list">
            {topProducts.map((p, i) => (
              <li key={p.id} className="pm-ranked-item">
                <span className={`pm-rank-index ${i === 0 ? "pm-rank-first" : ""}`}>{i + 1}</span>
                <div className="pm-rank-icon">
                  <Icon name={(p.iconKey as IconName) || "package"} size={16} />
                </div>
                <div className="pm-ranked-info">
                  <strong className="pm-ranked-name">{p.name}</strong>
                  <span className="pm-ranked-cat">{p.categoryName}</span>
                </div>
                <strong className="pm-ranked-count">{p.applicationCount.toLocaleString()}</strong>
              </li>
            ))}
            {topProducts.length === 0 && <p className="pm-empty-hint">No application activity yet.</p>}
          </ul>
        </div>

        <div className="pm-dashboard-panel">
          <div className="pm-panel-head">
            <div>
              <h3 className="pm-panel-title">Product Status Distribution</h3>
              <p className="pm-panel-subtitle">Active catalog distribution and lifecycle status</p>
            </div>
          </div>
          <div className="pm-donut-row">
            <DonutChart segments={statusDistribution.map((s) => ({ label: formatStatusLabel("Product", s.status), value: s.count, percentage: s.percentage }))} total={statusTotal} centerLabel="Total" />
            <DonutLegend segments={statusDistribution.map((s) => ({ label: formatStatusLabel("Product", s.status), value: s.count, percentage: s.percentage }))} />
          </div>
        </div>

        <div className="pm-dashboard-panel">
          <div className="pm-panel-head">
            <div>
              <h3 className="pm-panel-title">Recent Products</h3>
              <p className="pm-panel-subtitle">Recently onboarded and updated marketplace offerings</p>
            </div>
          </div>
          <ul className="pm-recent-list">
            {recentProducts.map((p) => (
              <li key={p.id} className="pm-recent-item">
                <div className="pm-recent-icon">
                  <Icon name={(p.iconKey as IconName) || "package"} size={16} />
                </div>
                <div className="pm-recent-info">
                  <strong className="pm-recent-name">{p.name}</strong>
                  <span className="pm-recent-cat">{p.categoryName}</span>
                </div>
                <div className="pm-recent-list-end">
                  <StatusBadge status={p.status} entityType="Product" />
                  <span className="pm-recent-time">{formatRelativeTime(p.createdAt)}</span>
                </div>
              </li>
            ))}
            {recentProducts.length === 0 && <p className="pm-empty-hint">No recent products.</p>}
          </ul>
        </div>

        <div className="pm-dashboard-panel">
          <div className="pm-panel-head">
            <div>
              <h3 className="pm-panel-title">Top Searches</h3>
              <p className="pm-panel-subtitle">Most popular customer search queries and lookups</p>
            </div>
          </div>
          <ul className="pm-search-bars">
            {topSearches.map((s) => (
              <li key={s.term} className="pm-search-item">
                <span className="pm-search-term">{s.term}</span>
                <div className="pm-search-bar-track">
                  <div className="pm-search-bar-fill" style={{ width: `${(s.count / maxSearchCount) * 100}%` }} />
                </div>
                <span className="pm-search-count">{s.count.toLocaleString()}</span>
              </li>
            ))}
            {topSearches.length === 0 && <p className="pm-empty-hint">No search activity yet.</p>}
          </ul>
        </div>
      </div>

      {summary && (
        <div className="pm-insights-grid">
          <div className="pm-insight-card">
            <div className="pm-insight-icon pm-insight-icon-green">
              <Icon name="trending-up" size={18} />
            </div>
            <div className="pm-insight-content">
              <strong className="pm-insight-title">High Demand</strong>
              <p className="pm-insight-text">{topSearch ? `"${topSearch.term}" searches lead this period with ${topSearch.count.toLocaleString()} lookups` : "No search activity yet"}</p>
            </div>
          </div>
          <div className="pm-insight-card">
            <div className="pm-insight-icon pm-insight-icon-blue">
              <Icon name="building" size={18} />
            </div>
            <div className="pm-insight-content">
              <strong className="pm-insight-title">Top Performer</strong>
              <p className="pm-insight-text">{topProduct ? `${topProduct.name} leads with ${topProduct.applicationCount.toLocaleString()} applications` : "No applications yet"}</p>
            </div>
          </div>
          <div className="pm-insight-card">
            <div className="pm-insight-icon pm-insight-icon-purple">
              <Icon name="grid" size={18} />
            </div>
            <div className="pm-insight-content">
              <strong className="pm-insight-title">Top Category</strong>
              <p className="pm-insight-text">{topCategory ? `${topCategory.categoryName} generates ${topCategory.percentage}% of total applications` : "No category data yet"}</p>
            </div>
          </div>
          <div className="pm-insight-card">
            <div className="pm-insight-icon pm-insight-icon-amber">
              <Icon name="arrow-up" size={18} />
            </div>
            <div className="pm-insight-content">
              <strong className="pm-insight-title">Growth</strong>
              <p className="pm-insight-text">Total applications {summary.totalApplications.changePercent >= 0 ? "increased" : "decreased"} by {Math.abs(summary.totalApplications.changePercent)}% this week</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
