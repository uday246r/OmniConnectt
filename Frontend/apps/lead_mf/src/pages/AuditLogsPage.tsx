import React, { useEffect } from 'react';
import { ShieldCheck, Search, RefreshCw, Eye, Download, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { useLeadStore } from '../store/useLeadStore';
import { AuditDetailsDrawer } from '../components/audit/AuditDetailsDrawer';

export const AuditLogsPage: React.FC = () => {
  const {
    auditLogs,
    auditSearchQuery,
    auditActionFilter,
    isLoadingAuditLogs,
    fetchAuditLogs,
    openAuditDetails,
    setAuditSearchQuery,
    setAuditActionFilter,
    // Pagination — this state and the fetchAuditLogs page/pageSize wiring already existed in the
    // store; only the UI to drive it was missing, so only the first page (10 rows) of audit history
    // was ever reachable no matter how much existed.
    auditPage,
    auditPageSize,
    totalAuditRecords,
    setAuditPage,
  } = useLeadStore();

  const totalAuditPages = Math.max(1, Math.ceil(totalAuditRecords / auditPageSize));
  const auditStartIndex = totalAuditRecords > 0 ? (auditPage - 1) * auditPageSize + 1 : 0;
  const auditEndIndex = Math.min(auditPage * auditPageSize, totalAuditRecords);

  useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

  const handleExportCSV = () => {
    if (!auditLogs || auditLogs.length === 0) return;

    const headers = ['ID', 'Timestamp', 'User Name', 'User Role', 'Action Type', 'Description', 'Reason', 'Status', 'IP Address'];
    const csvRows = [headers.join(',')];

    auditLogs.forEach((log) => {
      const row = [
        `"${(log.id || '').toString().replace(/"/g, '""')}"`,
        `"${(log.timestamp || '').toString().replace(/"/g, '""')}"`,
        `"${(log.userName || '').toString().replace(/"/g, '""')}"`,
        `"${(log.userRole || '').toString().replace(/"/g, '""')}"`,
        `"${(log.actionType || '').toString().replace(/"/g, '""')}"`,
        `"${(log.description || '').toString().replace(/"/g, '""')}"`,
        `"${(log.reason || '').toString().replace(/"/g, '""')}"`,
        `"${(log.status || '').toString().replace(/"/g, '""')}"`,
        `"${(log.ipAddress || '').toString().replace(/"/g, '""')}"`,
      ];
      csvRows.push(row.join(','));
    });

    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    const dateStr = new Date().toISOString().split('T')[0];
    link.setAttribute('href', url);
    link.setAttribute('download', `Audit_Trail_Logs_${dateStr}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const getActionBadge = (action: string) => {
    switch (action.toLowerCase()) {
      case 'create':
        return { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0', dot: '#10b981' };
      case 'edit':
      case 'update':
        return { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe', dot: '#2563eb' };
      case 'delete':
        return { bg: '#fff1f2', text: '#be123c', border: '#fecdd3', dot: '#f43f5e' };
      case 'view':
        return { bg: '#ede9fe', text: '#6d28d9', border: '#ddd6fe', dot: '#8b5cf6' };
      default:
        return { bg: '#f1f5f9', text: '#475569', border: '#e2e8f0', dot: '#64748b' };
    }
  };

  // The table used to render the raw backend action code (CREATE/EDIT/DELETE/VIEW) verbatim, even
  // though the filter dropdown's own options were already humanized ("Create Events", etc.) — this
  // brings the table in line with that.
  const getActionLabel = (action: string): string => {
    switch (action.toLowerCase()) {
      case 'create': return 'Created';
      case 'edit':
      case 'update': return 'Updated';
      case 'delete': return 'Deleted';
      case 'view': return 'Viewed';
      default: return action;
    }
  };

  const formatTimestamp = (ts: string) => {
    try {
      const date = new Date(ts);
      if (isNaN(date.getTime())) return ts;
      return date.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      });
    } catch {
      return ts;
    }
  };

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '22px',
        maxWidth: '1340px',
        width: '100%',
        paddingBottom: '32px',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
        boxSizing: 'border-box',
      }}
    >
      {/* Hero Banner — Host Pattern */}
      <div
        style={{
          borderRadius: '18px',
          padding: '24px 30px',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: '20px',
          flexWrap: 'wrap',
          position: 'relative',
          overflow: 'hidden',
          background: 'linear-gradient(120deg, #1e40af 0%, #2563eb 45%, #3b82f6 100%)',
          boxShadow: '0 4px 20px rgba(37, 99, 235, 0.25), 0 1px 4px rgba(37, 99, 235, 0.15)',
          boxSizing: 'border-box',
        }}
      >
        {/* Background decorative glass circles — matching host's exact sizes/offsets/opacity */}
        <div
          style={{
            position: 'absolute',
            top: '-50px',
            right: '-50px',
            width: '220px',
            height: '220px',
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.07)',
            pointerEvents: 'none',
          }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '-60px',
            right: '120px',
            width: '160px',
            height: '160px',
            borderRadius: '50%',
            background: 'rgba(255, 255, 255, 0.05)',
            pointerEvents: 'none',
          }}
        />

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '18px',
            minWidth: 0,
            position: 'relative',
            zIndex: 1,
          }}
        >
          <div
            style={{
              width: '50px',
              height: '50px',
              borderRadius: '14px',
              background: 'rgba(255, 255, 255, 0.18)',
              border: '1.5px solid rgba(255, 255, 255, 0.3)',
              backdropFilter: 'blur(8px)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              flexShrink: 0,
              boxShadow: '0 2px 8px rgba(0, 0, 0, 0.1)',
            }}
          >
            <ShieldCheck size={24} />
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1
                style={{
                  fontSize: '20px',
                  fontWeight: 800,
                  color: '#ffffff',
                  margin: 0,
                  letterSpacing: '-0.025em',
                  lineHeight: 1.2,
                  fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
                }}
              >
                Audit Trail Logs
              </h1>
              <span
                style={{
                  padding: '3px 10px',
                  borderRadius: '999px',
                  background: 'rgba(255, 255, 255, 0.2)',
                  color: '#ffffff',
                  fontSize: '11.5px',
                  fontWeight: 700,
                  border: '1px solid rgba(255, 255, 255, 0.3)',
                  backdropFilter: 'blur(4px)',
                }}
              >
                {auditLogs.length} Events Logged
              </span>
            </div>
            <p
              style={{
                fontSize: '13px',
                color: 'rgba(255, 255, 255, 0.85)',
                margin: 0,
              }}
            >
              Immutable compliance record of all lead creation, update, view, and deletion events
            </p>
          </div>
        </div>

        {/* Right Action: Export CSV */}
        <button
          type="button"
          onClick={handleExportCSV}
          disabled={auditLogs.length === 0}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '7px',
            height: '40px',
            padding: '0 18px',
            borderRadius: '12px',
            border: '1px solid rgba(255, 255, 255, 0.35)',
            background: 'rgba(255, 255, 255, 0.95)',
            color: '#1d4ed8',
            fontSize: '13.5px',
            fontWeight: 700,
            cursor: auditLogs.length === 0 ? 'not-allowed' : 'pointer',
            opacity: auditLogs.length === 0 ? 0.6 : 1,
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.12)',
            transition: 'all 0.15s ease',
            fontFamily: 'inherit',
            position: 'relative',
            zIndex: 1,
          }}
          onMouseEnter={(e) => {
            if (auditLogs.length > 0) {
              e.currentTarget.style.background = '#ffffff';
              e.currentTarget.style.transform = 'translateY(-1px)';
              e.currentTarget.style.boxShadow = '0 4px 16px rgba(0, 0, 0, 0.18)';
            }
          }}
          onMouseLeave={(e) => {
            if (auditLogs.length > 0) {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.95)';
              e.currentTarget.style.transform = 'none';
              e.currentTarget.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.12)';
            }
          }}
        >
          <Download size={15} />
          <span>Export CSV</span>
        </button>
      </div>

      {/* Main Table Container Card */}
      <div
        style={{
          background: '#ffffff',
          borderRadius: '16px',
          border: '1px solid #eaecf0',
          boxShadow: '0 1px 4px rgba(15, 23, 42, 0.04)',
          /* overflow must NOT be hidden here — that would clip the inner overflowX:auto scroll container,
             making the table un-scrollable on mobile. The border-radius is preserved by the card's own
             background/border, not by overflow clipping. */
          overflow: 'visible',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {/* Toolbar */}
        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            padding: '16px 20px',
            borderBottom: '1px solid #eaecf0',
            background: '#ffffff',
          }}
        >
          {/* Action Filter & Search */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, maxWidth: '520px', flexWrap: 'wrap' }}>
            <select
              value={auditActionFilter}
              onChange={(e) => setAuditActionFilter(e.target.value)}
              className="form-input"
              style={{
                width: '160px',
                height: '40px',
                appearance: 'auto',
                cursor: 'pointer',
                fontSize: '13px',
              }}
            >
              <option value="">All Action Types</option>
              <option value="CREATE">Create Events</option>
              <option value="EDIT">Update Events</option>
              <option value="DELETE">Deletion Events</option>
              <option value="VIEW">View Audits</option>
            </select>

            <div style={{ position: 'relative', flex: 1, minWidth: '220px' }}>
              <Search
                size={14}
                style={{
                  position: 'absolute',
                  left: '14px',
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: '#94a3b8',
                  pointerEvents: 'none',
                }}
              />
              <input
                type="text"
                placeholder="Search description, user, IP..."
                value={auditSearchQuery}
                onChange={(e) => setAuditSearchQuery(e.target.value)}
                className="form-input"
                style={{
                  height: '40px',
                  paddingLeft: '38px',
                  paddingRight: auditSearchQuery ? '34px' : '14px',
                  fontSize: '13px',
                }}
              />
              {auditSearchQuery && (
                <button
                  type="button"
                  onClick={() => setAuditSearchQuery('')}
                  style={{
                    position: 'absolute',
                    right: '10px',
                    top: '50%',
                    transform: 'translateY(-50%)',
                    background: 'none',
                    border: 'none',
                    color: '#94a3b8',
                    cursor: 'pointer',
                    display: 'flex',
                    alignItems: 'center',
                    padding: '2px',
                  }}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>

          {/* Reload Button */}
          <button
            type="button"
            onClick={() => fetchAuditLogs()}
            title="Refresh Logs"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '40px',
              height: '40px',
              borderRadius: '12px',
              border: '1.5px solid #e2e8f0',
              background: '#ffffff',
              color: '#475569',
              cursor: 'pointer',
              transition: 'all 0.15s ease',
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.04)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = '#f8fafc';
              e.currentTarget.style.borderColor = '#c8d4e0';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = '#ffffff';
              e.currentTarget.style.borderColor = '#e2e8f0';
            }}
          >
            <RefreshCw size={15} className={isLoadingAuditLogs ? 'animate-spin' : ''} />
          </button>
        </div>

        {/* Main Table */}
        {isLoadingAuditLogs ? (
          // Column-shaped, matching the real table's cells (host's AuditLogsPage skeleton rows use
          // the same per-cell-shape convention) — a centered spinner+text row gave no sense of the
          // table's structure while it loaded.
          <div style={{ overflowX: 'auto' }} aria-hidden="true">
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <tbody>
                {Array.from({ length: 8 }, (_, i) => (
                  <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
                    <td style={{ padding: '13px 18px' }}>
                      <div className="lead-skel" style={{ width: 120, height: 15 }} />
                    </td>
                    <td style={{ padding: '13px 18px' }}>
                      <div className="lead-skel" style={{ width: 84, height: 20, borderRadius: 6 }} />
                    </td>
                    <td style={{ padding: '13px 18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                        <div className="lead-skel" style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0 }} />
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                          <div className="lead-skel" style={{ width: 100, height: 13 }} />
                          <div className="lead-skel" style={{ width: 60, height: 11 }} />
                        </div>
                      </div>
                    </td>
                    <td style={{ padding: '13px 18px' }}>
                      <div className="lead-skel" style={{ width: '85%', height: 14 }} />
                    </td>
                    <td style={{ padding: '13px 18px' }}>
                      <div className="lead-skel" style={{ width: 70, height: 13, marginBottom: 5 }} />
                      <div className="lead-skel" style={{ width: 90, height: 11 }} />
                    </td>
                    <td style={{ padding: '13px 18px', textAlign: 'right' }}>
                      <div className="lead-skel" style={{ width: 60, height: 26, borderRadius: 7, marginLeft: 'auto' }} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : auditLogs.length === 0 ? (
          <div style={{ padding: '64px 20px', textAlign: 'center', color: '#64748b' }}>
            <div style={{ fontSize: '32px', marginBottom: '8px' }}>🛡️</div>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
              No audit logs found
            </div>
            <div style={{ fontSize: '13px', color: '#64748b' }}>
              {auditSearchQuery || auditActionFilter
                ? 'Try adjusting your filter or search query.'
                : 'System events and compliance trails will appear here automatically.'}
            </div>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px', textAlign: 'left' }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '1px solid #eaecf0' }}>
                  <th style={{ padding: '12px 18px', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b' }}>
                    Timestamp
                  </th>
                  <th style={{ padding: '12px 18px', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b' }}>
                    Action
                  </th>
                  <th style={{ padding: '12px 18px', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b' }}>
                    Actor / Role
                  </th>
                  <th style={{ padding: '12px 18px', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b' }}>
                    Event Description
                  </th>
                  <th style={{ padding: '12px 18px', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b' }}>
                    Status & IP
                  </th>
                  <th style={{ padding: '12px 18px', fontWeight: 700, fontSize: '11px', textTransform: 'uppercase', letterSpacing: '0.04em', color: '#64748b', textAlign: 'right' }}>
                    Details
                  </th>
                </tr>
              </thead>
              <tbody>
                {auditLogs.map((log) => {
                  const badge = getActionBadge(log.actionType);

                  return (
                    <tr
                      key={log.id}
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
                      {/* Timestamp */}
                      <td style={{ padding: '13px 18px', color: '#0f172a', fontWeight: 500, whiteSpace: 'nowrap' }}>
                        {formatTimestamp(log.timestamp)}
                      </td>

                      {/* Action code */}
                      <td style={{ padding: '13px 18px' }}>
                        <span
                          style={{
                            display: 'inline-block',
                            fontFamily: "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, Consolas, monospace",
                            padding: '2px 8px',
                            borderRadius: '6px',
                            background: badge.bg,
                            color: badge.text,
                            fontSize: '11.5px',
                            fontWeight: 600,
                            border: `1px solid ${badge.border}`,
                          }}
                        >
                          {getActionLabel(log.actionType)}
                        </span>
                      </td>

                      {/* Actor & Role */}
                      <td style={{ padding: '13px 18px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                          <span
                            style={{
                              width: 26,
                              height: 26,
                              borderRadius: 8,
                              background: 'linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%)',
                              color: '#6d28d9',
                              border: '1px solid #c4b5fd',
                              fontSize: 11,
                              fontWeight: 700,
                              letterSpacing: '-0.02em',
                              display: 'flex',
                              alignItems: 'center',
                              justifyContent: 'center',
                              flexShrink: 0,
                            }}
                          >
                            {(log.userName || 'S').charAt(0).toUpperCase()}
                          </span>
                          <div>
                            <div style={{ fontWeight: 600, color: '#0f172a', fontSize: 13 }}>{log.userName || 'System'}</div>
                            <div style={{ color: '#64748b', fontSize: '11.5px', marginTop: '1px' }}>{log.userRole || 'User'}</div>
                          </div>
                        </div>
                      </td>

                      {/* Description */}
                      <td style={{ padding: '13px 18px', color: '#334155', maxWidth: '300px' }}>
                        <div>{log.description}</div>
                        {log.reason && (
                          <div style={{ fontSize: '11.5px', color: '#94a3b8', marginTop: '2px', fontStyle: 'italic' }}>
                            Reason: {log.reason}
                          </div>
                        )}
                      </td>

                      {/* Status & IP */}
                      <td style={{ padding: '13px 18px' }}>
                        {(() => {
                          const isSuccess = log.status?.toUpperCase() === 'SUCCESS';
                          return (
                            <span
                              style={{
                                display: 'inline-flex',
                                alignItems: 'center',
                                gap: 4,
                                fontSize: '11.5px',
                                fontWeight: 600,
                                padding: '2px 9px',
                                borderRadius: 999,
                                background: isSuccess ? '#ecfdf5' : '#fef2f2',
                                color: isSuccess ? '#047857' : '#dc2626',
                                border: `1px solid ${isSuccess ? '#a7f3d0' : '#fecaca'}`,
                              }}
                            >
                              <span
                                style={{
                                  width: 5,
                                  height: 5,
                                  borderRadius: '50%',
                                  background: isSuccess ? '#10b981' : '#dc2626',
                                  flexShrink: 0,
                                }}
                              />
                              {log.status}
                            </span>
                          );
                        })()}
                        <div style={{ fontSize: '11.5px', color: '#94a3b8', marginTop: '3px', fontFamily: "'SF Mono', 'Fira Code', monospace" }}>
                          {log.ipAddress || '127.0.0.1'}
                        </div>
                      </td>

                      {/* Inspect Button */}
                      <td style={{ padding: '13px 18px', textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            openAuditDetails(log);
                          }}
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '4px',
                            padding: '5px 11px',
                            borderRadius: '8px',
                            border: '1px solid #bfdbfe',
                            background: '#eff6ff',
                            color: '#1d4ed8',
                            fontSize: '12px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            transition: 'all 0.12s ease',
                            fontFamily: 'inherit',
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = '#dbeafe';
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = '#eff6ff';
                          }}
                        >
                          <Eye size={13} />
                          <span>Inspect</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination — same pattern as ViewLeadPage.tsx's working footer, wired to the
            auditPage/auditPageSize/totalAuditRecords state that already existed in the store. */}
        {totalAuditRecords > 0 && (
          <div
            style={{
              padding: '14px 20px',
              borderTop: '1px solid #eaecf0',
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '12px',
              background: '#f8fafc',
              fontSize: '13px',
              color: '#64748b',
            }}
          >
            <div>
              Showing <strong style={{ color: '#0f172a' }}>{auditStartIndex}</strong> to{' '}
              <strong style={{ color: '#0f172a' }}>{auditEndIndex}</strong> of{' '}
              <strong style={{ color: '#0f172a' }}>{totalAuditRecords}</strong> events
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
              <button
                type="button"
                disabled={auditPage <= 1}
                onClick={() => setAuditPage(auditPage - 1)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  border: '1.5px solid #e2e8f0',
                  background: '#ffffff',
                  color: '#0f172a',
                  cursor: auditPage <= 1 ? 'not-allowed' : 'pointer',
                  opacity: auditPage <= 1 ? 0.4 : 1,
                  transition: 'all 0.12s ease',
                }}
              >
                <ChevronLeft size={14} />
              </button>
              <span style={{ fontWeight: 600, color: '#0f172a', padding: '0 4px' }}>
                {auditPage} / {totalAuditPages}
              </span>
              <button
                type="button"
                disabled={auditPage >= totalAuditPages}
                onClick={() => setAuditPage(auditPage + 1)}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  width: '32px',
                  height: '32px',
                  borderRadius: '8px',
                  border: '1.5px solid #e2e8f0',
                  background: '#ffffff',
                  color: '#0f172a',
                  cursor: auditPage >= totalAuditPages ? 'not-allowed' : 'pointer',
                  opacity: auditPage >= totalAuditPages ? 0.4 : 1,
                  transition: 'all 0.12s ease',
                }}
              >
                <ChevronRight size={14} />
              </button>
            </div>
          </div>
        )}
      </div>

      <AuditDetailsDrawer />
    </div>
  );
};

export default AuditLogsPage;
