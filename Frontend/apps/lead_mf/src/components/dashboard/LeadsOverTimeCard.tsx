import React from 'react';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import card from '../../shared/dashboardCard.module.css';
import styles from './LeadsOverTimeCard.module.css';
import { useLeadStore } from '../../store/useLeadStore';
import { Select, SkeletonBlock } from '@omniremit/ui';

const GRANULARITY_LABELS: Record<string, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
};

export const LeadsOverTimeCard: React.FC = () => {
  const { leadsOverTime, dashboardGranularity, setDashboardGranularity, isLoadingDashboard } =
    useLeadStore();

  return (
    /* widgetCard — matches host exactly */
    <div
      className={card.card}
    >
      {/* widgetHeader */}
      <div
        className={card.cardHeader}
      >
        <div>
          <h2
            className={card.cardTitle}
          >
            Leads Over Time
          </h2>
          <p className={card.cardSubtitle}>
            Application submission trends
          </p>
        </div>

        <div className={styles.granularityPicker}>
          <Select
            aria-label="Group by"
            size="sm"
            value={dashboardGranularity}
            onChange={(e) => setDashboardGranularity(e.target.value as 'daily' | 'weekly' | 'monthly')}
            options={[
              { value: 'daily', label: 'Daily' },
              { value: 'weekly', label: 'Weekly' },
              { value: 'monthly', label: 'Monthly' },
            ]}
          />
        </div>
      </div>

      {/* Chart */}
      <div className={styles.chartArea}>
        {isLoadingDashboard ? (
          /* Shaped like the plot area it replaces, so the card keeps its height. */
          <SkeletonBlock width="100%" height={220} radius="8px" />
        ) : leadsOverTime.length === 0 ? (
          <div
            className={styles.chartState}
          >
            No leads recorded in the selected period.
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={leadsOverTime} margin={{ top: 5, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="leadAreaGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#2563eb" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#2563eb" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'Inter, sans-serif' }}
                axisLine={{ stroke: '#e2e8f0' }}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fontSize: 11, fill: '#64748b', fontFamily: 'Inter, sans-serif' }}
                axisLine={false}
                tickLine={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: '#0f172a',
                  border: 'none',
                  borderRadius: '8px',
                  color: '#ffffff',
                  fontSize: '12px',
                  boxShadow: '0 4px 6px rgba(0,0,0,0.1)',
                  fontFamily: 'Inter, sans-serif',
                }}
                labelStyle={{ fontWeight: 600, color: '#93c5fd' }}
                formatter={(value: any) => [`${value} Leads`, 'Leads']}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="#2563eb"
                strokeWidth={2.5}
                fillOpacity={1}
                fill="url(#leadAreaGradient)"
                dot={{ r: 3, fill: '#2563eb', strokeWidth: 0 }}
                activeDot={{ r: 5, fill: '#2563eb', stroke: '#ffffff', strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}
      </div>

      {/* Granularity label footer */}
      <div className={styles.footnote}>
        Showing: <strong className={styles.footnoteStrong}>{GRANULARITY_LABELS[dashboardGranularity]}</strong> breakdown
      </div>
    </div>
  );
};
