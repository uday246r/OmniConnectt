import React from 'react';
import { Users, UserPlus, Hourglass, CheckCircle2, TrendingUp } from '@omniremit/ui/icons';
import { useLeadStore } from '../../store/useLeadStore';
import { SkeletonBlock } from '@omniremit/ui';
import styles from './KpiCardSection.module.css';

const formatKpiValue = (val: number | null | undefined, isPercentage = false): string => {
  if (val === null || val === undefined) return '-';
  if (isPercentage) return `${val.toFixed(1)}%`;
  return val.toLocaleString();
};

/* Inline CSS for top accent bars via style tag — mirrors host ::before pseudo-element pattern */
const KPI_CONFIG = [
  {
    title: 'Total Leads',
    subtitle: 'Platform-wide',
    icon: <Users size={20} />,
    iconWrapClass: 'iconWrapBlue',
    trend: '↑ All Applications',
    key: 'totalLeads' as const,
  },
  {
    title: 'New Leads',
    subtitle: 'New entries',
    icon: <UserPlus size={20} />,
    iconWrapClass: 'iconWrapPurple',
    trend: '↑ Incoming leads',
    key: 'newLeads' as const,
  },
  {
    title: 'In Progress',
    subtitle: 'Credit review',
    icon: <Hourglass size={20} />,
    iconWrapClass: 'iconWrapEmerald',
    trend: '↑ Under review',
    key: 'inProgressLeads' as const,
  },
  {
    title: 'Converted',
    subtitle: 'Approved & disbursed',
    icon: <CheckCircle2 size={20} />,
    iconWrapClass: 'iconWrapGreen',
    trend: '↑ Successful apps',
    key: 'convertedLeads' as const,
  },
  {
    title: 'Conversion Rate',
    subtitle: 'Approval efficiency',
    icon: <TrendingUp size={20} />,
    iconWrapClass: 'iconWrapTeal',
    trend: '↑ Performance',
    key: 'conversionRate' as const,
    isPercentage: true,
  },
];

const ICON_WRAP_STYLES: Record<string, React.CSSProperties> = {
  iconWrapBlue:    { background: '#eff6ff', color: '#2563eb' },
  iconWrapPurple:  { background: '#ede9fe', color: '#7c3aed' },
  iconWrapEmerald: { background: '#fffbeb', color: '#d97706' },
  iconWrapGreen:   { background: '#ecfdf5', color: '#059669' },
  iconWrapTeal:    { background: '#f0fdfa', color: '#0d9488' },
};

export const KpiCardSection: React.FC = () => {
  const { kpiSummary, isLoadingDashboard } = useLeadStore();

  return (
    <>
      {/* Inject accent bar CSS once */}

      <div
        className={styles.grid}
      >
        {KPI_CONFIG.map((kpi) => {
          const rawVal = kpiSummary[kpi.key];
          const displayVal = formatKpiValue(rawVal as number, kpi.isPercentage);

          return (
            <div key={kpi.key} className={styles.card}>
              {/* Top Row: Icon + Label */}
              <div
                className={styles.cardTop}
              >
                <div
                  className={styles.iconWrap}
                  style={ICON_WRAP_STYLES[kpi.iconWrapClass]}
                >
                  {kpi.icon}
                </div>
                <span
                  className={styles.cardLabel}
                >
                  {kpi.title}
                </span>
              </div>

              {/* Metric Value */}
              <div className={styles.valueRow}>
                <span
                  className={styles.value}
                >
                  {/*
                    A shimmer the size of the number, not a literal '...' — three dots read as a real
                    value that happens to be dots, and swapping them for a long figure resized the card.
                  */}
                  {isLoadingDashboard ? <SkeletonBlock width={84} height={26} radius="7px" /> : displayVal}
                </span>
              </div>

              {/* Trend Row */}
              <div
                className={styles.cardTop}
              >
                <span
                  className={styles.trendUp}
                >
                  {kpi.trend}
                </span>
                <span
                  className={styles.caption}
                >
                  {kpi.subtitle}
                </span>
              </div>
            </div>
          );
        })}
      </div>
    </>
  );
};
