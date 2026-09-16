import React from 'react';
import { Eye, ArrowRight, Clock } from '@omniconnect/ui/icons';
import { DataTable, ResponsiveRows, getInitials } from '@omniconnect/ui';
import card from '../../shared/dashboardCard.module.css';
import { useLeadStore } from '../../store/useLeadStore';
import { useHostNavigate } from '../../navigation/HostNavigation';
import styles from './RecentLeadsCard.module.css';
import { LeadStatusBadge } from '../../shared/LeadStatusBadge';
export const RecentLeadsCard: React.FC = () => {
  const { recentLeads, isLoadingDashboard, openDetailsDrawer } = useLeadStore();
  const navigate = useHostNavigate();

  const handleViewAll = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    navigate('view-lead');
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
      {!isLoadingDashboard && recentLeads.length === 0 ? (
        <div className={styles.state}>
          <Clock size={28} className={styles.stateIcon} />
          <span>No recent leads recorded in this period.</span>
        </div>
      ) : (
        <div className={styles.tableFrame}>
          <DataTable bare>
            {/*
             * The row is deliberately not clickable — the "View" button in the last cell is the
             * single, explicit way in, matching the host's audit table and the other lead tables. A
             * whole-row handler makes it impossible to select text in a cell without navigating
             * away, and gives no keyboard equivalent.
             */}
            <ResponsiveRows
              rows={recentLeads}
              rowKey={(lead) => String(lead.id)}
              loading={isLoadingDashboard}
              loadingRows={5}
              columns={[
                {
                  key: 'customer',
                  label: 'Customer',
                  priority: 'always',
                  render: (lead) => (
                    <div className={styles.customer}>
                      <div className={styles.avatar}>{getInitials(lead.name)}</div>
                      <div>
                        <div className={styles.customerName}>{lead.name}</div>
                        {/* LeadRecord has no `leadReference` field — `id` is the real identifier. */}
                        {lead.id && <div className={styles.customerId}>{lead.id}</div>}
                      </div>
                    </div>
                  ),
                },
                {
                  key: 'product',
                  label: 'Product',
                  priority: 'high',
                  render: (lead) => <span className={styles.productChip}>{lead.product}</span>,
                },
                {
                  key: 'branch',
                  label: 'Branch / State',
                  priority: 'low',
                  render: (lead) => (
                    <span className={styles.mutedCell}>{lead.branch || 'Not Assigned'}</span>
                  ),
                },
                {
                  key: 'status',
                  label: 'Status',
                  priority: 'always',
                  render: (lead) => <LeadStatusBadge status={lead.status} />,
                },
                {
                  key: 'date',
                  label: 'Date',
                  priority: 'low',
                  render: (lead) => <span className={styles.dateCell}>{lead.createdDate}</span>,
                },
                {
                  key: 'action',
                  label: 'Action',
                  priority: 'always',
                  align: 'right',
                  render: (lead) => (
                    <button
                      type="button"
                      onClick={(e) => handleActionClick(e, lead)}
                      title="View Full Lead Profile"
                      className={styles.rowAction}
                    >
                      <Eye size={13} />
                      <span>View</span>
                    </button>
                  ),
                },
              ]}
            />
          </DataTable>
        </div>
      )}
    </div>
  );
};
