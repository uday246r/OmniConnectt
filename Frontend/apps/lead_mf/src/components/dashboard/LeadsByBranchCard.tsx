import React from 'react';
import card from '../../shared/dashboardCard.module.css';
import styles from './LeadsByBranchCard.module.css';
import { useLeadStore } from '../../store/useLeadStore';

const BRANCH_COLORS = [
  '#4f46e5', '#3b82f6', '#10b981', '#f59e0b', '#ec4899', '#0d9488',
];

export const LeadsByBranchCard: React.FC = () => {
  const { leadsByBranch, isLoadingDashboard } = useLeadStore();

  const sortedBranches = [...leadsByBranch].sort((a, b) => b.count - a.count);
  const maxCount = Math.max(...sortedBranches.map((b) => b.count), 1);

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
            Leads by Branch
          </h2>
          <p className={card.cardSubtitle}>
            Regional distribution of applications
          </p>
        </div>
      </div>

      {/* appsList container */}
      <div
        className={styles.list}
      >
        {isLoadingDashboard ? (
          <div className={styles.listState}>
            Loading branch data...
          </div>
        ) : sortedBranches.length === 0 ? (
          <div className={styles.listState}>
            No branch data available.
          </div>
        ) : (
          sortedBranches.map((branch, idx) => {
            const color = BRANCH_COLORS[idx % BRANCH_COLORS.length];
            const barPct = Math.round((branch.count / maxCount) * 100);

            return (
              /* appRow */
              <div
                key={idx}
                className={styles.row}
              >
                {/* appRowIcon */}
                <div
                  className={styles.rankBadge}
                  style={{ '--branch-tint': `${color}18`, '--branch-color': color } as React.CSSProperties}
                >
                  {(branch.branchName || 'B').slice(0, 2).toUpperCase()}
                </div>

                {/* appRowContent */}
                <div className={styles.rowBody}>
                  <div className={styles.rowTitleLine}>
                    <span
                      className={styles.rowName}
                    >
                      {branch.branchName}
                    </span>
                    <span className={styles.rowPct}>
                      {barPct}%
                    </span>
                  </div>
                  {/* progressBarTrack */}
                  <div
                    className={styles.barTrack}
                  >
                    <div
                        className={styles.barFill}
                        style={{ '--bar-pct': `${barPct}%`, '--branch-color': color } as React.CSSProperties}
                    />
                  </div>
                </div>

                {/* Status pill */}
                <span
                  className={styles.countPill}
                >
                  <span className={styles.countDot} />
                  {branch.count}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
