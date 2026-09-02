import React from 'react';
import { Eye, ArrowRight, Clock } from 'lucide-react';
import { DataTable } from '@omniremit/ui';
import card from '../../shared/dashboardCard.module.css';
import { useLeadStore } from '../../store/useLeadStore';
import styles from './RecentLeadsCard.module.css';
import { LeadStatusBadge } from '../../shared/LeadStatusBadge';

const getInitials = (name: string): string => {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/).filter((p) => !['bin', 'binti', 'a/l', 'a/p'].includes(p.toLowerCase()));
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

export const RecentLeadsCard: React.FC = () => {
  const { recentLeads, isLoadingDashboard, setActivePage, openDetailsDrawer } = useLeadStore();

  const handleViewAll = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setActivePage('view-lead');
  };

  const handleActionClick = (e: React.MouseEvent, lead: any) => {
    e.preventDefault();
    e.stopPropagation();
    openDetailsDrawer(lead);
  };

  return (
    <div
      className={`${card.card} ${styles.card}`}
    >
      {/* Header */}
      <div
        className={styles.header}
      >
        <div>
          <h2
            className={card.cardTitle}
          >
            Recent Lead Submissions
          </h2>
          <p className={card.cardSubtitle}>
            Latest incoming customer financing inquiries
          </p>
        </div>

        <button
          type="button"
          onClick={handleViewAll}
          className={styles.viewAllBtn}
        >
          <span>View Directory</span>
          <ArrowRight size={13} />
        </button>
      </div>

      {/* Table Content */}
      {isLoadingDashboard ? (
        <div className={styles.state}>
          Loading recent leads...
        </div>
      ) : recentLeads.length === 0 ? (
        <div className={styles.state}>
          <Clock size={28} className={styles.stateIcon} />
          <span>No recent leads recorded in this period.</span>
        </div>
      ) : (
        <div className={styles.tableFrame}>
          <DataTable bare>
            <thead>
              <tr>
                <th>
                  Customer
                </th>
                <th>
                  Product
                </th>
                <th>
                  Branch / State
                </th>
                <th>
                  Status
                </th>
                <th>
                  Date
                </th>
                <th className={styles.thRight}>
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {recentLeads.map((lead) => {
                const initials = getInitials(lead.name);

                /*
                 * The row is deliberately not clickable — the "View Full Lead Profile" button in the
                 * last cell is the single, explicit way in, matching the host's audit table and the
                 * other lead tables. A whole-row handler makes it impossible to select text in a
                 * cell without navigating away, and gives no keyboard equivalent.
                 *
                 * The hover highlight stays (it aids reading across a wide row) but `cursor: pointer`
                 * is gone, so the row no longer advertises a click it does not handle.
                 */
                return (
                  <tr
                    key={lead.id}
                  >
                    {/* Customer Name with Avatar */}
                    <td className={styles.cell}>
                      <div className={styles.customer}>
                        <div
                          className={styles.avatar}
                        >
                          {initials}
                        </div>
                        <div>
                          <div className={styles.customerName}>{lead.name}</div>
                          {/* LeadRecord has no `leadReference` field — `id` is the real identifier. */}
                          {lead.id && (
                            <div className={styles.customerId}>{lead.id}</div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Product */}
                    <td className={styles.cell}>
                      <span
                        className={styles.productChip}
                      >
                        {lead.product}
                      </span>
                    </td>

                    {/* Branch */}
                    <td className={`${styles.cell} ${styles.mutedCell}`}>
                      {lead.branch || 'Not Assigned'}
                    </td>

                    {/* Status Pill Badge */}
                    <td className={styles.cell}>
                      <LeadStatusBadge status={lead.status} />
                    </td>

                    {/* Date */}
                    <td className={`${styles.cell} ${styles.dateCell}`}>
                      {lead.createdDate}
                    </td>

                    {/* Action Button */}
                    <td className={`${styles.cell} ${styles.cellRight}`}>
                      <button
                        type="button"
                        onClick={(e) => handleActionClick(e, lead)}
                        title="View Full Lead Profile"
                        className={styles.rowAction}
                      >
                        <Eye size={13} />
                        <span>View</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </DataTable>
        </div>
      )}
    </div>
  );
};
