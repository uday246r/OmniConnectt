import { useEffect, useMemo } from 'react';
import { Button, DataTable, EmptyState, Icon, PageHeader, Select, SkeletonBlock, formatDate, formatRelativeTime } from '@omniconnect/ui';
import { BarChart } from '../../components/charts/BarChart';
import { DonutChart } from '../../components/charts/DonutChart';
import { CatalogIcon } from '../../components/CatalogIcon';
import { KpiTile } from '../../components/KpiTile';
import { StatusBadge } from '../../components/StatusBadge';
import { useCatalogOptionsStore } from '../../stores/useCatalogOptionsStore';
import { useDashboardStore } from '../../stores/useDashboardStore';
import { resolveStatus, useStatusConfigStore } from '../../stores/useStatusConfigStore';
import { formatAuditAction, formatNumber } from '../../utils/format';
import page from '../page.module.css';
import styles from './dashboard.module.css';

const PRODUCT_STATUS = 'Product';

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

  const compared = summary?.comparedDays ?? 30;
  const changeLabel = `vs previous ${compared} days`;
  const categoryOptions = useMemo(() => categories.map((c) => ({ value: c.id, label: c.name })), [categories]);

  const segments = useMemo(
    () => distribution.map((d) => {
      const status = resolveStatus(byKey, PRODUCT_STATUS, d.status);
      return { key: d.status, label: status.label, value: d.count, tone: status.tone };
    }),
    [distribution, byKey],
  );
  const totalProducts = distribution.reduce((sum, d) => sum + d.count, 0);

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
          Array.from({ length: 5 }, (_, i) => <SkeletonBlock key={i} width="100%" height={132} radius="14px" />)
        ) : summary ? (
          <>
            <KpiTile label="Total products" value={summary.totalProducts.value} changePercent={summary.totalProducts.changePercent} changeLabel={changeLabel} accent="primary" icon={<Icon.Box />} caption="All products" />
            <KpiTile label="Live products" value={summary.liveProducts.value} changePercent={summary.liveProducts.changePercent} changeLabel={changeLabel} accent="success" icon={<Icon.CheckCircle />} caption="Status is live" />
            <KpiTile label="Not live" value={summary.unpublishedProducts.value} changePercent={summary.unpublishedProducts.changePercent} changeLabel={changeLabel} accent="warning" icon={<Icon.FileText />} caption="Drafts and inactive" />
            <KpiTile label="Categories" value={summary.totalCategories.value} changePercent={summary.totalCategories.changePercent} changeLabel={changeLabel} accent="info" icon={<Icon.Layers />} caption="Lines of business" />
            <KpiTile label="Sub-categories" value={summary.totalSubCategories.value} changePercent={summary.totalSubCategories.changePercent} changeLabel={changeLabel} accent="danger" icon={<Icon.Grid />} caption="Types of product" />
          </>
        ) : null}
      </div>

      <div className={styles.grid2}>
        <section className={`${page.card} ${styles.panel}`} aria-label="Products by category">
          <div className={styles.panelHead}>
            <div>
              <h2 className={styles.panelTitle}>{breakdownCategoryId ? 'Products by sub-category' : 'Products by category'}</h2>
              <p className={styles.panelHint}>{breakdownCategoryId ? 'Every product beneath the chosen category.' : 'Every product, whatever its status.'}</p>
            </div>
            <div className={styles.select}>
              <Select aria-label="Show products for" options={categoryOptions} value={breakdownCategoryId} placeholder="All categories" clearLabel="All categories" onChange={(e) => void setBreakdownCategory(e.target.value)} />
            </div>
          </div>
          <BarChart data={breakdown.map((b) => ({ id: b.id, label: b.name, value: b.count }))} ariaLabel={breakdownCategoryId ? 'Products per sub-category' : 'Products per category'} emptyText="No categories yet." />
        </section>

        <section className={`${page.card} ${styles.panel}`} aria-label="Product status distribution">
          <div>
            <h2 className={styles.panelTitle}>Product status</h2>
            <p className={styles.panelHint}>How products are spread across statuses.</p>
          </div>
          {segments.length === 0 ? (
            <p className={styles.emptyNote}>No products yet.</p>
          ) : (
            <div className={styles.donutRow}>
              <DonutChart segments={segments} centerValue={totalProducts} centerLabel="Products" ariaLabel="Products by status" />
              <ul className={styles.legend}>
                {segments.map((segment) => (
                  <li key={segment.key} className={styles.legendItem}>
                    <span className={`${styles.swatch} ${styles[`swatch_${segment.tone}`]}`} aria-hidden="true" />
                    {segment.label}
                    <span className={styles.legendCount}>{formatNumber(segment.value)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>

      <div className={styles.grid2}>
        <section className={`${page.card} ${styles.panel}`} aria-label="Recently added products">
          <div>
            <h2 className={styles.panelTitle}>Recently added products</h2>
            <p className={styles.panelHint}>The latest products in the catalogue.</p>
          </div>
          {recentProducts.length === 0 ? (
            <p className={styles.emptyNote}>Nothing added yet.</p>
          ) : (
            <DataTable bare minWidth={520}>
              <thead>
                <tr>
                  <th scope="col">Product</th>
                  <th scope="col">Category</th>
                  <th scope="col">Sub-category</th>
                  <th scope="col">Status</th>
                  <th scope="col">Added</th>
                </tr>
              </thead>
              <tbody>
                {recentProducts.map((product) => (
                  <tr key={product.id}>
                    <td>
                      <div className={page.nameCell}>
                        <CatalogIcon iconKey={product.iconKey} size="sm" />
                        <span className={page.name}>{product.name}</span>
                      </div>
                    </td>
                    <td className={page.muted}>{product.categoryName}</td>
                    <td className={page.muted}>{product.subCategoryName}</td>
                    <td><StatusBadge entityType={PRODUCT_STATUS} value={product.status} /></td>
                    <td className={page.muted}>{formatDate(product.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </DataTable>
          )}
        </section>

        <section className={`${page.card} ${styles.panel}`} aria-label="Recent activity">
          <div>
            <h2 className={styles.panelTitle}>Recent activity</h2>
            <p className={styles.panelHint}>Latest changes to the catalogue.</p>
          </div>
          {recentActivity.length === 0 ? (
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
    </div>
  );
}
