import React from 'react';
import { ResponsiveContainer, PieChart, Pie, Cell, Tooltip } from 'recharts';
import card from '../../shared/dashboardCard.module.css';
import styles from './LeadsByProductCard.module.css';
import { useLeadStore } from '../../store/useLeadStore';
import { SkeletonAvatar, SkeletonText } from '@omniconnect/ui';
import { useShallow } from 'zustand/react/shallow';

export const LeadsByProductCard: React.FC = () => {
  const { leadsByProduct, kpiSummary, isLoadingDashboard } = useLeadStore(useShallow((s) => ({ leadsByProduct: s.leadsByProduct, kpiSummary: s.kpiSummary, isLoadingDashboard: s.isLoadingDashboard })));
  const totalLeads = kpiSummary.totalLeads;

  return (
    /* widgetCard */
    <div
      className={card.card}
    >
      {/* widgetHeader */}
      <div className={card.cardHeader}>
        <div>
          <h2
            className={card.cardTitle}
          >
            Leads by Product
          </h2>
          <p className={card.cardSubtitle}>
            Product distribution across applications
          </p>
        </div>
      </div>

      {isLoadingDashboard ? (
        /* Donut plus its legend rows — the two things this card actually draws. */
        <div className={card.chartSkeleton}>
          <SkeletonAvatar size={132} />
          <div className={card.legendSkeleton}>
            <SkeletonText lines={5} />
          </div>
        </div>
      ) : leadsByProduct.length === 0 ? (
        <div
          className={card.chartState}
        >
          No product distribution data available.
        </div>
      ) : (
        /* donutContainer */
        <div className={card.chartBody}>
          {/* Donut SVG Wrap */}
          <div className={styles.donutWrap}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={leadsByProduct}
                  dataKey="count"
                  nameKey="productName"
                  cx="50%"
                  cy="50%"
                  innerRadius={48}
                  outerRadius={68}
                  paddingAngle={2}
                  stroke="none"
                >
                  {leadsByProduct.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.color} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#0f172a',
                    border: 'none',
                    borderRadius: '8px',
                    color: '#ffffff',
                    fontSize: '12px',
                    fontFamily: 'Inter, sans-serif',
                  }}
                  formatter={(value: any, name: any) => [`${value} Leads`, name]}
                />
              </PieChart>
            </ResponsiveContainer>

            {/* donutCenter */}
            <div
              className={styles.donutCenter}
            >
              <span
                className={styles.donutTotal}
              >
                {totalLeads.toLocaleString()}
              </span>
              <span
                className={styles.donutLabel}
              >
                Total
              </span>
            </div>
          </div>

          {/* legendList */}
          <div
            className={styles.legend}
          >
            {leadsByProduct.map((item, idx) => (
              /* legendItem */
              <div
                key={idx}
                className={styles.legendRow}
              >
                {/* legendLeft */}
                <div className={styles.legendLeft}>
                  <span
                    className={styles.legendSwatch}
                    style={{ '--legend-color': item.color } as React.CSSProperties}
                  />
                  <span
                    className={styles.legendName}
                  >
                    {item.productName}
                  </span>
                </div>
                {/* legendStat */}
                <span
                  className={styles.legendStat}
                >
                  {item.count}{' '}
                  <span className={styles.legendPct}>({item.percentage}%)</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};
