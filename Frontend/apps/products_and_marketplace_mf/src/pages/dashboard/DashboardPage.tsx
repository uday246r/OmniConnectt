import { useEffect, useMemo, useState } from 'react';
import { Button, DataTable, EmptyState, Icon, PageHeader, ResponsiveRows, Select, SkeletonChart, SkeletonList, StatTile, StatTileSkeleton, formatDate, formatRelativeTime, type ResponsiveColumn } from '@omniconnect/ui';
import { BarChart } from '../../components/charts/BarChart';
import { DonutChart } from '../../components/charts/DonutChart';
import { CatalogIcon } from '../../components/CatalogIcon';
import { StatusBadge } from '../../components/StatusBadge';
import { useCatalogOptionsStore } from '../../stores/useCatalogOptionsStore';
import { useDashboardStore } from '../../stores/useDashboardStore';
import { resolveStatus, useStatusConfigStore } from '../../stores/useStatusConfigStore';
import type { RecentProduct } from '../../types/domain';
import { formatAuditAction, formatNumber } from '../../utils/format';
import page from '../page.module.css';
import styles from './dashboard.module.css';

const PRODUCT_STATUS = 'Product';

const DASHBOARD_TABS = [
  { key: 'overview', label: 'Overview', icon: Icon.Layers },
  { key: 'analytics', label: 'Analytics & Charts', icon: Icon.Activity },
  { key: 'activity', label: 'Recent & Activity', icon: Icon.Clock },
] as const;

type DashboardTabId = (typeof DASHBOARD_TABS)[number]['key'];

export function DashboardPage() {
  const summary = useDashboardStore((s) => s.summary);
  const breakdown = useDashboardStore((s) => s.breakdown);
  const breakdownCategoryId = useDashboardStore((s) => s.breakdownCategoryId);
  const distribution = useDashboardStore((s) => s.distribution);
  const recentProducts = useDashboardStore((s) => s.recentProducts);
  const recentActivity = useDashboardStore((s) => s.recentActivity);
  const loaded = useDashboardStore((s) => s.loaded);
  const loading = useDashboardStore((s) => s.loading);
  const error = useDashboardStore((s) => s.error);
  const load = useDashboardStore((s) => s.load);
  const setBreakdownCategory = useDashboardStore((s) => s.setBreakdownCategory);
  const categories = useCatalogOptionsStore((s) => s.categories);
  const loadCategories = useCatalogOptionsStore((s) => s.loadCategories);
  const byKey = useStatusConfigStore((s) => s.byKey);

  useEffect(() => {
    void load();
    void loadCategories();
  }, [load, loadCategories]);

  // The first read only: a refetch keeps what is on screen rather than flashing placeholders over it.
  const firstLoad = !loaded && loading;
  const [activeTab, setActiveTab] = useState<DashboardTabId>('overview');
  const categoryOptions = useMemo(() => categories.map((c) => ({ value: c.id, label: c.name })), [categories]);

  const segments = useMemo(
    () => distribution.map((d) => {
      const status = resolveStatus(byKey, PRODUCT_STATUS, d.status);
      return { key: d.status, label: status.label, value: d.count, tone: status.tone };
    }),
    [distribution, byKey],
  );
  const totalProducts = distribution.reduce((sum, d) => sum + d.count, 0);

  const recentColumns: ResponsiveColumn<RecentProduct>[] = [
    {
      key: 'name',
      label: 'Product',
      priority: 'always',
      render: (product) => (
        <div className={page.nameCell}>
          <CatalogIcon iconKey={product.iconKey} size="sm" />
          <span className={page.name}>{product.name}</span>
        </div>
      ),
    },
    { key: 'category', label: 'Category', priority: 'low', render: (p) => <span className={page.muted}>{p.categoryName}</span> },
    { key: 'subCategory', label: 'Sub-category', priority: 'low', render: (p) => <span className={page.muted}>{p.subCategoryName}</span> },
    { key: 'status', label: 'Status', priority: 'high', render: (p) => <StatusBadge entityType={PRODUCT_STATUS} value={p.status} /> },
    { key: 'added', label: 'Added', priority: 'high', render: (p) => <span className={page.muted}>{formatDate(p.createdAt)}</span> },
  ];

  return (
    <div className={page.page}>
      <PageHeader icon={<Icon.Package />} title="Product catalogue overview" subtitle="Manage and monitor your products, categories and sub-categories" />

      {error && (
        <div role="alert" className={page.error}>
          <span>{error}</span>
          <Button variant="secondary" size="sm" onClick={() => void load()}>Try again</Button>
        </div>
      )}

      <div className={page.kpis} aria-busy={loading}>
        {!loaded && loading ? (
          Array.from({ length: 5 }, (_, i) => <StatTileSkeleton key={i} />)
        ) : summary ? (
          <>
            <StatTile label="Total products" value={summary.totalProducts.value} accent="primary" icon={<Icon.Box />} />
            <StatTile label="Live products" value={summary.liveProducts.value} accent="success" icon={<Icon.CheckCircle />} />
            <StatTile label="Not live" value={summary.unpublishedProducts.value} accent="warning" icon={<Icon.FileText />} />
            <StatTile label="Categories" value={summary.totalCategories.value} accent="violet" icon={<Icon.Layers />} />
            <StatTile label="Sub-categories" value={summary.totalSubCategories.value} accent="neutral" icon={<Icon.Grid />} />
          </>
        ) : null}
      </div>

      {/* Dashboard view tabs styled identically to the host's Approval Center */}
      <div className={styles.navBar}>
        <div className={styles.tabsList} role="tablist" aria-label="Dashboard views">
          {DASHBOARD_TABS.map((tab) => {
            const TabIcon = tab.icon;
            const isSelected = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                role="tab"
                id={`dashboard-tab-${tab.key}`}
                aria-selected={isSelected}
                className={`${styles.tabBtn} ${isSelected ? styles.tabActive : ''}`}
                onClick={() => setActiveTab(tab.key)}
              >
                <TabIcon width={16} height={16} />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {(activeTab === 'overview' || activeTab === 'analytics') && (
        <div className={styles.grid2}>
          <section className={`${page.card} ${styles.panel}`} aria-label="Products by category">
            <div className={styles.panelHead}>
              <div className={styles.panelTitleGroup}>
                <div className={styles.panelIconBadgeCategory}>
                  <Icon.Grid width={16} height={16} />
                </div>
                <div>
                  <div className={styles.panelTitleRow}>
                    <h2 className={styles.panelTitle}>{breakdownCategoryId ? 'Products by sub-category' : 'Products by category'}</h2>
                    <span className={styles.panelBadge}>
                      {breakdown.length} {breakdownCategoryId ? 'sub-categories' : 'categories'}
                    </span>
                  </div>
                  <p className={styles.panelHint}>{breakdownCategoryId ? 'Every product beneath the chosen category.' : 'Distribution of active products across catalog categories.'}</p>
                </div>
              </div>
              <div className={styles.select}>
                <Select aria-label="Show products for" options={categoryOptions} value={breakdownCategoryId} placeholder="All categories" clearLabel="All categories" onChange={(e) => void setBreakdownCategory(e.target.value)} />
              </div>
            </div>
            {firstLoad ? (
              <div className={styles.chartFrame}><SkeletonChart variant="bars" /></div>
            ) : (
              <BarChart data={breakdown.map((b) => ({ id: b.id, label: b.name, value: b.count }))} ariaLabel={breakdownCategoryId ? 'Products per sub-category' : 'Products per category'} emptyText="No categories yet." />
            )}
          </section>

          <section className={`${page.card} ${styles.panel}`} aria-label="Product status distribution">
            <div className={styles.panelHead}>
              <div className={styles.panelTitleGroup}>
                <div className={styles.panelIconBadgeStatus}>
                  <Icon.PieChart width={16} height={16} />
                </div>
                <div>
                  <div className={styles.panelTitleRow}>
                    <h2 className={styles.panelTitle}>Product status</h2>
                    <span className={styles.panelBadge}>{totalProducts} total</span>
                  </div>
                  <p className={styles.panelHint}>How products are spread across lifecycle statuses.</p>
                </div>
              </div>
            </div>
            {firstLoad ? (
              <div className={styles.donutFrame}><SkeletonChart variant="donut" /></div>
            ) : segments.length === 0 ? (
              <p className={styles.emptyNote}>No products yet.</p>
            ) : (
              <div className={styles.donutRow}>
                <DonutChart segments={segments} centerValue={totalProducts} centerLabel="Products" ariaLabel="Products by status" />
                <ul className={styles.legend}>
                  {segments.map((segment) => {
                    const pct = totalProducts > 0 ? Math.round((segment.value / totalProducts) * 100) : 0;
                    return (
                      <li key={segment.key} className={styles.legendItem}>
                        <span className={`${styles.swatch} ${styles[`swatch_${segment.tone}`]}`} aria-hidden="true" />
                        <span className={styles.legendLabelText}>{segment.label}</span>
                        <span className={styles.legendPct}>({pct}%)</span>
                        <span className={styles.legendCount}>{formatNumber(segment.value)}</span>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </section>
        </div>
      )}

      {(activeTab === 'overview' || activeTab === 'activity') && (
        <div className={styles.grid2}>
          <section className={`${page.card} ${styles.panel}`} aria-label="Recently added products">
            <div>
              <h2 className={styles.panelTitle}>Recently added products</h2>
              <p className={styles.panelHint}>The latest products in the catalogue.</p>
            </div>
            {/* Was a bare table with neither a skeleton nor an empty state — just a <p> note. */}
            <DataTable bare>
              <ResponsiveRows
                columns={recentColumns}
                rows={recentProducts}
                rowKey={(product) => product.id}
                loading={firstLoad}
                loadingRows={5}
                empty="Nothing added yet."
              />
            </DataTable>
          </section>

          <section className={`${page.card} ${styles.panel}`} aria-label="Recent activity">
            <div>
              <h2 className={styles.panelTitle}>Recent activity</h2>
              <p className={styles.panelHint}>Latest changes to the catalogue.</p>
            </div>
            {firstLoad ? (
              <SkeletonList rows={5} leading="dot" />
            ) : recentActivity.length === 0 ? (
              loaded ? <EmptyState compact title="No activity yet" description="Changes will appear here as they are made." /> : null
            ) : (
              <ul className={styles.activity}>
                {recentActivity.map((entry) => (
                  <li key={entry.id} className={styles.activityItem}>
                    <span className={styles.activityDot} aria-hidden="true" />
                    <div className={styles.activityText}>
                      <span><strong>{formatAuditAction(entry.action)}</strong> · {entry.entityName || entry.entityType}</span>
                      <span className={page.sub}>by {entry.actorName}</span>
                    </div>
                    <span className={styles.activityWhen}>{formatRelativeTime(entry.timestamp)}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
