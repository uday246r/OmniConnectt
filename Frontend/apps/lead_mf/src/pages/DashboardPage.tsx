import React, { useEffect, lazy, Suspense } from 'react';
import { useLeadStore } from '../store/useLeadStore';
import { canSeeDashboardCapability } from '../api/hostBridge';
import { DashboardHeader } from '../components/dashboard/DashboardHeader';
import { KpiCardSection } from '../components/dashboard/KpiCardSection';
import { LeadsByBranchCard } from '../components/dashboard/LeadsByBranchCard';
import { RecentLeadsCard } from '../components/dashboard/RecentLeadsCard';
import { LeadDetailsDrawer } from '../components/lead/LeadDetailsDrawer';
import styles from './DashboardPage.module.css';
import shell from '../shared/leadPage.module.css';

/*
 * These two cards are the only recharts consumers on the dashboard, and recharts is by a wide margin
 * the heaviest dependency here. Imported statically they sat in the page's main chunk, so the
 * browser had to download and parse the entire charting library before it could paint ANYTHING —
 * including the KPI row and the recent-leads table, neither of which needs it.
 *
 * Splitting them out lets the rest of the dashboard paint immediately while the chart bundle streams
 * in behind a placeholder that matches the cards' own loading state. The data fetches are unaffected:
 * fetchDashboardData already issues all five calls through a single Promise.all, so the charts have
 * their data waiting by the time the chunk lands.
 */
const LeadsOverTimeCard = lazy(() =>
  import('../components/dashboard/LeadsOverTimeCard').then((m) => ({ default: m.LeadsOverTimeCard }))
);
const LeadsByProductCard = lazy(() =>
  import('../components/dashboard/LeadsByProductCard').then((m) => ({ default: m.LeadsByProductCard }))
);

/** Mirrors the chart cards' own in-card loading treatment so the swap is not a visual jolt. */
const ChartCardFallback: React.FC = () => (
  <div
    className={styles.panel}
  />
);

export const DashboardPage: React.FC = () => {
  const { fetchDashboardData, fetchMasterData, products } = useLeadStore();

  // Capability keys, not component names — they match LeadCapabilityManifest exactly, which is what
  // an administrator sees in the Role editor and what the server enforces.
  const canSeeOverTime = canSeeDashboardCapability('chart.leads-over-time');
  const canSeeByProduct = canSeeDashboardCapability('chart.leads-by-product');
  const canSeeByBranch = canSeeDashboardCapability('chart.leads-by-branch');
  const canSeeRecentLeads = canSeeDashboardCapability('widget.recent-leads');

  useEffect(() => {
    fetchDashboardData();
    if (products.length === 0) {
      fetchMasterData();
    }
  }, [fetchDashboardData, fetchMasterData, products.length]);

  return (
    <div
      className={shell.page}
    >

      {/* Hero Welcome Banner */}
      <DashboardHeader />

      {/* 5 KPI Stat Cards */}
      <KpiCardSection />

      {/*
       * Each chart and widget is granted separately, so the page is assembled from whatever this
       * user actually holds rather than always laid out the same way and selectively blanked.
       *
       * A row with nothing in it is dropped entirely — an empty two-column grid leaves a band of
       * whitespace that reads as a rendering fault, not as a permission. The endpoints behind these
       * refuse the same requests server-side; hiding the card is what keeps the page coherent.
       */}
      {(canSeeOverTime || canSeeByProduct) && (
        <div
          className={styles.chartRow}
        >
          {/* One boundary per card so a slow chunk cannot hold the other chart back. Leads by
              Product renders first (left), Leads Over Time second (right). */}

          {canSeeOverTime && (
            <Suspense fallback={<ChartCardFallback />}>
              <LeadsOverTimeCard />
            </Suspense>
          )}

          {canSeeByProduct && (
            <Suspense fallback={<ChartCardFallback />}>
              <LeadsByProductCard />
            </Suspense>
          )}
    
        </div>
      )}

      {/* Row 2: Branch Distribution — Top Sales Executives removed, so this is a single column now
          rather than leaving an empty gap where it used to sit. */}
      {canSeeByBranch && (
        <div
          className={styles.section}
        >
          <LeadsByBranchCard />
        </div>
      )}

      {/* Row 3: Recent Leads — full width */}
      {canSeeRecentLeads && <RecentLeadsCard />}

      {/* Lead Details Side Drawer */}
      <LeadDetailsDrawer />
    </div>
  );
};

export default DashboardPage;
