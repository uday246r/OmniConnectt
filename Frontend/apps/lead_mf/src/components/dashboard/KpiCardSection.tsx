import React from 'react';
import { Users, UserPlus, Hourglass, CheckCircle2, TrendingUp } from 'lucide-react';
import { useLeadStore } from '../../store/useLeadStore';
import { SkeletonBlock } from '@omniremit/ui/skeleton';

const formatKpiValue = (val: number | null | undefined, isPercentage = false): string => {
  if (val === null || val === undefined) return '-';
  if (isPercentage) return `${val.toFixed(1)}%`;
  return val.toLocaleString();
};

/* Inline CSS for top accent bars via style tag — mirrors host ::before pseudo-element pattern */
const ACCENT_BARS_CSS = `
.kpi-card:nth-child(1)::before { background: linear-gradient(90deg, #2563eb, #60a5fa); }
.kpi-card:nth-child(2)::before { background: linear-gradient(90deg, #7c3aed, #a78bfa); }
.kpi-card:nth-child(3)::before { background: linear-gradient(90deg, #d97706, #fbbf24); }
.kpi-card:nth-child(4)::before { background: linear-gradient(90deg, #059669, #34d399); }
.kpi-card:nth-child(5)::before { background: linear-gradient(90deg, #0d9488, #2dd4bf); }
.kpi-card {
  background: #ffffff;
  border: 1px solid #eaecf0;
  border-radius: 14px;
  padding: 18px 20px 16px;
  box-shadow: 0 1px 3px rgba(15, 23, 42, 0.04);
  display: flex;
  flex-direction: column;
  gap: 10px;
  position: relative;
  overflow: hidden;
  transition: box-shadow 150ms ease, transform 150ms ease;
  cursor: default;
  box-sizing: border-box;
}
.kpi-card::before {
  content: '';
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  border-radius: 14px 14px 0 0;
}
.kpi-card:hover {
  box-shadow: 0 6px 20px rgba(15, 23, 42, 0.08);
  transform: translateY(-1px);
}

/* Same breakpoints as the host's own .statCardsGrid (DashboardPage.module.css) — this grid had no
   responsive handling at all before, so 5 cards would just squeeze themselves illegibly narrow on
   tablet/mobile instead of wrapping the way the host's stat grid does. */
@media (max-width: 1100px) {
  .kpi-card-grid { grid-template-columns: repeat(2, 1fr) !important; }
}
@media (max-width: 600px) {
  .kpi-card-grid { grid-template-columns: 1fr !important; }
}
@media (max-width: 480px) {
  .kpi-card-grid { gap: 10px !important; }
  .kpi-card { padding: 14px 16px 12px; }
  .kpi-card .kpi-value { font-size: 24px !important; }
}
`;

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
      <style>{ACCENT_BARS_CSS}</style>

      <div
        className="kpi-card-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(5, 1fr)',
          gap: '16px',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {KPI_CONFIG.map((kpi) => {
          const rawVal = kpiSummary[kpi.key];
          const displayVal = formatKpiValue(rawVal as number, kpi.isPercentage);

          return (
            <div key={kpi.key} className="kpi-card">
              {/* Top Row: Icon + Label */}
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <div
                  style={{
                    width: '36px',
                    height: '36px',
                    borderRadius: '10px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                    ...ICON_WRAP_STYLES[kpi.iconWrapClass],
                  }}
                >
                  {kpi.icon}
                </div>
                <span
                  style={{
                    fontSize: '12px',
                    fontWeight: 600,
                    color: '#64748b',
                    letterSpacing: '0.01em',
                    textAlign: 'right',
                  }}
                >
                  {kpi.title}
                </span>
              </div>

              {/* Metric Value */}
              <div style={{ display: 'flex', alignItems: 'baseline' }}>
                <span
                  className="kpi-value"
                  style={{
                    fontSize: '28px',
                    fontWeight: 800,
                    color: '#0f172a',
                    lineHeight: 1,
                    letterSpacing: '-0.03em',
                    fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                  }}
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
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                }}
              >
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: '3px',
                    color: '#059669',
                    fontSize: '11.5px',
                    fontWeight: 600,
                  }}
                >
                  {kpi.trend}
                </span>
                <span
                  style={{
                    fontSize: '11px',
                    color: '#94a3b8',
                    fontWeight: 500,
                  }}
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
