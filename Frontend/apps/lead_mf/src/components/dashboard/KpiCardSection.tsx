import React from 'react';
import { Users, UserPlus, Hourglass, CheckCircle2, TrendingUp } from '@omniremit/ui/icons';
import { useLeadStore } from '../../store/useLeadStore';
import { canSeeDashboardCapability } from '../../api/hostBridge';
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
    capability: 'kpi.total-leads',
  },
  {
    title: 'New Leads',
    subtitle: 'New entries',
    icon: <UserPlus size={20} />,
    iconWrapClass: 'iconWrapPurple',
    trend: '↑ Incoming leads',
    key: 'newLeads' as const,
    capability: 'kpi.new-leads',
  },
  {
    title: 'In Progress',
    subtitle: 'Credit review',
    icon: <Hourglass size={20} />,
    iconWrapClass: 'iconWrapEmerald',
    trend: '↑ Under review',
    key: 'inProgressLeads' as const,
    capability: 'kpi.in-progress',
  },
  {
    title: 'Converted',
    subtitle: 'Approved & disbursed',
    icon: <CheckCircle2 size={20} />,
    iconWrapClass: 'iconWrapGreen',
    trend: '↑ Successful apps',
    key: 'convertedLeads' as const,
    capability: 'kpi.converted',
  },
  {
    title: 'Conversion Rate',
    subtitle: 'Approval efficiency',
    icon: <TrendingUp size={20} />,
    iconWrapClass: 'iconWrapTeal',
    trend: '↑ Performance',
    key: 'conversionRate' as const,
    capability: 'kpi.conversion-rate',
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

  /*
   * Each card is a grant of its own.
   *
   * Which cards a role should see is a business decision, not a technical one, so it is configured
   * in the host's Role editor rather than decided here — this component only asks. The card is
   * removed rather than blanked: an empty card labelled "Total Leads" invites someone to report it
   * as broken, and the grid reflows cleanly with fewer.
   *
   * This is presentation. The numbers themselves are withheld server-side too: the two cards with
   * their own endpoints answer 403, and the three that share one response come back null. Removing
   * the card is what makes the page coherent, not what makes it safe.
   */
  const visibleKpis = KPI_CONFIG.filter((kpi) => canSeeDashboardCapability(kpi.capability));

  if (visibleKpis.length === 0) {
    return null;
  }

  return (
    <>
      {/* Inject accent bar CSS once */}

      <div
        className={styles.grid}
      >
        {visibleKpis.map((kpi) => {
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
