import React from 'react';
import { Eye, ArrowRight, Clock } from 'lucide-react';
import { useLeadStore } from '../../store/useLeadStore';

const getInitials = (name: string): string => {
  if (!name) return '??';
  const parts = name.trim().split(/\s+/).filter((p) => !['bin', 'binti', 'a/l', 'a/p'].includes(p.toLowerCase()));
  if (parts.length >= 2) {
    return (parts[0][0] + parts[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
};

const getStatusBadge = (status?: string) => {
  const s = status?.toLowerCase() || 'new';
  if (s.includes('convert')) {
    return { bg: '#d1fae5', text: '#065f46', dot: '#059669', label: status || 'Converted' };
  }
  if (s.includes('progress')) {
    return { bg: '#fef3c7', text: '#92400e', dot: '#d97706', label: status || 'In Progress' };
  }
  if (s.includes('reject')) {
    return { bg: '#fee2e2', text: '#991b1b', dot: '#dc2626', label: status || 'Rejected' };
  }
  return { bg: '#eff6ff', text: '#1d4ed8', dot: '#2563eb', label: status || 'New' };
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
      style={{
        background: '#ffffff',
        borderRadius: '16px',
        border: '1px solid #eaecf0',
        padding: '20px 24px',
        boxShadow: '0 1px 4px rgba(15, 23, 42, 0.04)',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '280px',
        overflow: 'hidden',
        boxSizing: 'border-box',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '18px',
        }}
      >
        <div>
          <h2
            style={{
              fontSize: '14.5px',
              fontWeight: 700,
              color: '#0f172a',
              margin: 0,
              letterSpacing: '-0.02em',
              fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
            }}
          >
            Recent Lead Submissions
          </h2>
          <p style={{ fontSize: '12px', color: '#64748b', margin: '2px 0 0 0' }}>
            Latest incoming customer financing inquiries
          </p>
        </div>

        <button
          type="button"
          onClick={handleViewAll}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '6px',
            background: '#eff6ff',
            border: 'none',
            borderRadius: '8px',
            color: '#1d4ed8',
            fontSize: '12.5px',
            fontWeight: 600,
            padding: '6px 14px',
            cursor: 'pointer',
            transition: 'all 0.15s ease',
            fontFamily: 'inherit',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = '#dbeafe';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = '#eff6ff';
          }}
        >
          <span>View Directory</span>
          <ArrowRight size={13} />
        </button>
      </div>

      {/* Table Content */}
      {isLoadingDashboard ? (
        <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '13px', padding: '32px 0' }}>
          Loading recent leads...
        </div>
      ) : recentLeads.length === 0 ? (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: '13px', padding: '32px 0' }}>
          <Clock size={28} style={{ opacity: 0.4, marginBottom: '8px' }} />
          <span>No recent leads recorded in this period.</span>
        </div>
      ) : (
        <div style={{ overflowX: 'auto', borderRadius: '10px', border: '1px solid #f1f5f9' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
            <thead>
              <tr style={{ background: '#f8fafc', borderBottom: '1px solid #e2e8f0' }}>
                <th style={{ padding: '10px 14px', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b' }}>
                  Customer
                </th>
                <th style={{ padding: '10px 14px', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b' }}>
                  Product
                </th>
                <th style={{ padding: '10px 14px', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b' }}>
                  Branch / State
                </th>
                <th style={{ padding: '10px 14px', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b' }}>
                  Status
                </th>
                <th style={{ padding: '10px 14px', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b' }}>
                  Date
                </th>
                <th style={{ padding: '10px 14px', fontWeight: 600, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b', textAlign: 'right' }}>
                  Action
                </th>
              </tr>
            </thead>
            <tbody>
              {recentLeads.map((lead) => {
                const statusInfo = getStatusBadge(lead.status);
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
                    style={{
                      borderBottom: '1px solid #f1f5f9',
                      transition: 'background 0.12s ease',
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.background = '#f8fafc';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.background = 'transparent';
                    }}
                  >
                    {/* Customer Name with Avatar */}
                    <td style={{ padding: '12px 14px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <div
                          style={{
                            width: '32px',
                            height: '32px',
                            borderRadius: '50%',
                            background: '#eff6ff',
                            color: '#1d4ed8',
                            fontSize: '11.5px',
                            fontWeight: 700,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'center',
                            flexShrink: 0,
                            border: '1px solid #bfdbfe',
                          }}
                        >
                          {initials}
                        </div>
                        <div>
                          <div style={{ fontWeight: 600, color: '#0f172a' }}>{lead.name}</div>
                          {/* LeadRecord has no `leadReference` field — `id` is the real identifier. */}
                          {lead.id && (
                            <div style={{ fontSize: '11px', color: '#64748b' }}>{lead.id}</div>
                          )}
                        </div>
                      </div>
                    </td>

                    {/* Product */}
                    <td style={{ padding: '12px 14px' }}>
                      <span
                        style={{
                          padding: '3px 8px',
                          borderRadius: '6px',
                          background: '#f1f5f9',
                          color: '#334155',
                          fontSize: '12px',
                          fontWeight: 500,
                        }}
                      >
                        {lead.product}
                      </span>
                    </td>

                    {/* Branch */}
                    <td style={{ padding: '12px 14px', color: '#475569', fontSize: '12.5px' }}>
                      {lead.branch || 'Not Assigned'}
                    </td>

                    {/* Status Pill Badge */}
                    <td style={{ padding: '12px 14px' }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '5px',
                          padding: '2.5px 9px',
                          borderRadius: '999px',
                          background: statusInfo.bg,
                          color: statusInfo.text,
                          fontSize: '11.5px',
                          fontWeight: 600,
                        }}
                      >
                        <span
                          style={{
                            width: '5px',
                            height: '5px',
                            borderRadius: '50%',
                            background: statusInfo.dot,
                          }}
                        />
                        {statusInfo.label}
                      </span>
                    </td>

                    {/* Date */}
                    <td style={{ padding: '12px 14px', color: '#64748b', fontSize: '12px' }}>
                      {lead.createdDate}
                    </td>

                    {/* Action Button */}
                    <td style={{ padding: '12px 14px', textAlign: 'right' }}>
                      <button
                        type="button"
                        onClick={(e) => handleActionClick(e, lead)}
                        title="View Full Lead Profile"
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: '4px',
                          padding: '5px 10px',
                          borderRadius: '6px',
                          border: '1px solid #e2e8f0',
                          background: '#ffffff',
                          color: '#1d4ed8',
                          fontSize: '12px',
                          fontWeight: 600,
                          cursor: 'pointer',
                          transition: 'all 0.12s ease',
                          fontFamily: 'inherit',
                        }}
                        onMouseEnter={(e) => {
                          e.currentTarget.style.background = '#eff6ff';
                          e.currentTarget.style.borderColor = '#bfdbfe';
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = '#ffffff';
                          e.currentTarget.style.borderColor = '#e2e8f0';
                        }}
                      >
                        <Eye size={13} />
                        <span>View</span>
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};
