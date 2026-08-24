import React, { useEffect, useState } from 'react';
import {
  Search,
  RefreshCw,
  Download,
  Eye,
  X,
  Shield,
  ShieldCheck,
  Clock,
  User,
  Target,
  FileText,
  CheckCircle2,
  AlertTriangle,
  Layers,
  Activity,
  Key,
  Globe,
  Box,
  Copy,
  Check,
  LayoutGrid,
} from 'lucide-react';
import { api, ApiError } from '../services/api';
import type { AuditLog } from '../types/api';
import { getFriendlyErrorMessage } from '../utils/errorMessages';

const getActionBadge = (action?: string) => {
  const a = (action || '').toLowerCase();
  if (a.includes('create') || a.includes('add') || a.includes('insert')) {
    return { bg: '#ecfdf5', text: '#047857', border: '#a7f3d0', dot: '#10b981' };
  }
  if (a.includes('edit') || a.includes('update') || a.includes('modify')) {
    return { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe', dot: '#2563eb' };
  }
  if (a.includes('delete') || a.includes('remove') || a.includes('purge')) {
    return { bg: '#fff1f2', text: '#be123c', border: '#fecdd3', dot: '#f43f5e' };
  }
  return { bg: '#eff6ff', text: '#1d4ed8', border: '#bfdbfe', dot: '#2563eb' };
};

function formatAuditTimestamp(iso?: string | null): string {
  if (!iso) return '—';
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return String(iso);

    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return String(iso);
  }
}

function getActorInitial(name?: string | null): string {
  if (!name) return 'S';
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.charAt(0) || 'S').toUpperCase();
}

export default function AuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pagination states
  const [pageNumber, setPageNumber] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('');

  // Selected Log for Details Drawer
  const [selectedLog, setSelectedLog] = useState<AuditLog | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // Lock body scroll when drawer is open
  useEffect(() => {
    if (detailsOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [detailsOpen]);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAuditLogs({
        search: searchQuery,
        action: actionFilter,
        pageNumber,
        pageSize,
      });
      setLogs(res.data || []);
      setTotalCount(res.totalCount || 0);
      setTotalPages(res.totalPages || 1);
    } catch (err) {
      const apiErr = err as ApiError;
      setError(getFriendlyErrorMessage(apiErr));
      console.error('Failed to load audit logs:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setPageNumber(1);
  }, [searchQuery, actionFilter]);

  useEffect(() => {
    fetchLogs();
  }, [pageNumber, pageSize, actionFilter, searchQuery]);

  const handleExportCSV = async () => {
    try {
      setLoading(true);
      const res = await api.getAuditLogs({
        search: searchQuery,
        action: actionFilter,
        pageNumber: 1,
        pageSize: 1000,
      });
      const allLogs = res.data || [];

      const headers = ['Timestamp', 'User', 'Action', 'Description', 'Status', 'Customer Name', 'Customer Type', 'Customer ID', 'Field'];
      const rows = allLogs.map((l) => [
        l.timestamp,
        l.user,
        l.action,
        l.description,
        l.status,
        l.customerName || '',
        l.customerType || '',
        l.customerId || '',
        l.field || '',
      ]);

      const csvContent = [
        headers.join(','),
        ...rows.map((r) => r.map((val) => `"${String(val).replace(/"/g, '""')}"`).join(',')),
      ].join('\n');

      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `Customer360_AuditLogs_${new Date().toISOString().split('T')[0]}.csv`);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      console.error('Failed to export CSV:', err);
    } finally {
      setLoading(false);
    }
  };

  const isSuccess = (selectedLog?.status || '').toUpperCase() === 'SUCCESS' || !selectedLog?.status;
  const actorName = selectedLog?.user || 'System Officer';
  const actorInitial = getActorInitial(actorName);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      {/* Hero Banner — Host Pattern */}
      <div className="c360-hero-banner">
        <div style={{ position: 'absolute', top: '-40px', right: '-40px', width: '180px', height: '180px', borderRadius: '50%', background: 'rgba(255, 255, 255, 0.08)', pointerEvents: 'none' }} />
        <div style={{ position: 'absolute', bottom: '-50px', right: '120px', width: '130px', height: '130px', borderRadius: '50%', background: 'rgba(255, 255, 255, 0.05)', pointerEvents: 'none' }} />

        <div className="c360-hero-left">
          <div
            style={{
              width: '50px',
              height: '50px',
              borderRadius: '14px',
              background: 'rgba(255, 255, 255, 0.18)',
              border: '1.5px solid rgba(255, 255, 255, 0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              flexShrink: 0,
            }}
          >
            <ShieldCheck size={24} />
          </div>

          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <h1 className="c360-hero-title">Customer 360° Audit Trail</h1>
              <span className="c360-hero-pill">
                {totalCount || logs.length} Events Logged
              </span>
            </div>
            <p className="c360-hero-subtitle">
              Immutable compliance and security logs of all customer profile lookups, views, and data access events
            </p>
          </div>
        </div>

        <button
          type="button"
          onClick={handleExportCSV}
          disabled={logs.length === 0}
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
            cursor: logs.length === 0 ? 'not-allowed' : 'pointer',
            opacity: logs.length === 0 ? 0.6 : 1,
            boxShadow: '0 2px 10px rgba(0, 0, 0, 0.12)',
            transition: 'all 0.15s ease',
            fontFamily: 'inherit',
            flexShrink: 0,
            position: 'relative',
            zIndex: 1,
          }}
        >
          <Download size={15} />
          <span>Export CSV</span>
        </button>
      </div>

      {/* Main Table Card */}
      <div className="c360-table-container">
        {/* Controls Toolbar */}
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: '12px',
            padding: '16px 20px',
            borderBottom: '1px solid #eaecf0',
            background: '#ffffff',
            flexWrap: 'wrap',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flex: 1, maxWidth: '520px', flexWrap: 'wrap' }}>
            <div className="c360-input-wrapper" style={{ flex: '1 1 240px' }}>
              <Search size={16} className="c360-input-icon" />
              <input
                type="text"
                placeholder="Search audit trail by officer, customer, or description..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="c360-input"
              />
            </div>

            <select
              value={actionFilter}
              onChange={(e) => setActionFilter(e.target.value)}
              className="c360-select"
              style={{ width: '160px', flexShrink: 0 }}
            >
              <option value="">All Actions</option>
              <option value="VIEW">View Profile</option>
              <option value="LOOKUP">Lookup Search</option>
              <option value="UPDATE">Profile Update</option>
              <option value="EXPORT">Data Export</option>
            </select>
          </div>

          <button
            type="button"
            onClick={fetchLogs}
            disabled={loading}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
              height: '38px',
              padding: '0 14px',
              borderRadius: '10px',
              border: '1px solid #eaecf0',
              background: '#ffffff',
              color: '#334155',
              fontSize: '13px',
              fontWeight: 600,
              cursor: 'pointer',
              boxShadow: '0 1px 2px rgba(15, 23, 42, 0.05)',
              fontFamily: 'inherit',
            }}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>

        {/* Error Banner */}
        {error && (
          <div style={{ padding: '16px 20px', background: '#fef2f2', borderBottom: '1px solid #fecaca', color: '#b91c1c', display: 'flex', alignItems: 'center', gap: '10px', fontSize: '13px' }}>
            <AlertTriangle size={18} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}

        {/* Table / Empty State */}
        {loading && logs.length === 0 ? (
          <div style={{ padding: '40px', textAlign: 'center', color: '#64748b' }}>
            <RefreshCw size={24} className="animate-spin" style={{ margin: '0 auto 12px', color: '#2563eb' }} />
            <p style={{ margin: 0, fontSize: '13.5px', fontWeight: 500 }}>Loading Customer 360° audit logs...</p>
          </div>
        ) : logs.length === 0 ? (
          <div style={{ padding: '48px 20px', textAlign: 'center', color: '#64748b' }}>
            <ShieldCheck size={36} style={{ margin: '0 auto 10px', color: '#94a3b8', opacity: 0.7 }} />
            <h3 style={{ margin: '0 0 4px', fontSize: '15px', color: '#0f172a', fontWeight: 600 }}>No audit logs found</h3>
            <p style={{ margin: 0, fontSize: '13px', color: '#64748b' }}>
              {searchQuery || actionFilter ? 'Try clearing filters or search queries.' : 'No customer audit events recorded yet.'}
            </p>
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table className="c360-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Action</th>
                  <th>Actor / Officer</th>
                  <th>Customer Reference</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th style={{ textAlign: 'right' }}>Details</th>
                </tr>
              </thead>
              <tbody>
                {logs.map((log, idx) => {
                  const badge = getActionBadge(log.action);

                  return (
                    <tr
                      key={idx}
                      style={{ transition: 'background 0.12s ease' }}
                      onMouseEnter={(e) => {
                        e.currentTarget.style.background = '#f8fafc';
                      }}
                      onMouseLeave={(e) => {
                        e.currentTarget.style.background = 'transparent';
                      }}
                    >
                      <td style={{ whiteSpace: 'nowrap', color: '#0f172a', fontWeight: 500 }}>
                        {formatAuditTimestamp(log.timestamp)}
                      </td>
                      <td>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            padding: '3px 10px',
                            borderRadius: '999px',
                            background: badge.bg,
                            color: badge.text,
                            fontSize: '11.5px',
                            fontWeight: 750,
                            border: `1px solid ${badge.border}`,
                          }}
                        >
                          <span style={{ width: '5px', height: '5px', borderRadius: '50%', background: badge.dot }} />
                          {(log.action || 'VIEW').toUpperCase()}
                        </span>
                      </td>
                      <td style={{ fontWeight: 600, color: '#0f172a' }}>{log.user || 'System'}</td>
                      <td>
                        <div style={{ fontWeight: 600, color: '#0f172a' }}>{log.customerName || '-'}</div>
                        {log.customerId && (
                          <div style={{ fontSize: '11.5px', color: '#64748b', fontFamily: "'SF Mono', 'Fira Code', monospace" }}>
                            {log.customerId}
                          </div>
                        )}
                      </td>
                      <td style={{ color: '#334155', maxWidth: '280px' }}>{log.description || '-'}</td>
                      <td>
                        <span
                          style={{
                            display: 'inline-flex',
                            alignItems: 'center',
                            gap: '5px',
                            padding: '3px 9px',
                            borderRadius: '999px',
                            fontSize: '11.5px',
                            fontWeight: 700,
                            background: isSuccess ? '#ecfdf5' : '#fff1f2',
                            color: isSuccess ? '#047857' : '#be123c',
                            border: `1px solid ${isSuccess ? '#a7f3d0' : '#fecdd3'}`,
                          }}
                        >
                          <span
                            style={{
                              width: '5px',
                              height: '5px',
                              borderRadius: '50%',
                              backgroundColor: isSuccess ? '#10b981' : '#f43f5e',
                            }}
                          />
                          {log.status || 'Success'}
                        </span>
                      </td>
                      <td style={{ textAlign: 'right' }}>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedLog(log);
                            setDetailsOpen(true);
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
                            fontFamily: 'inherit',
                            transition: 'all 0.12s ease',
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
      </div>

      {/* Pagination */}
      {totalCount > pageSize && (
        <div className="c360-pagination">
          <button
            type="button"
            className="c360-page-btn"
            disabled={pageNumber <= 1}
            onClick={() => setPageNumber((p) => p - 1)}
          >
            &lt; Previous
          </button>
          <span className="c360-page-indicator">
            Page {pageNumber} of {totalPages}
          </span>
          <button
            type="button"
            className="c360-page-btn"
            disabled={pageNumber >= totalPages}
            onClick={() => setPageNumber((p) => p + 1)}
          >
            Next &gt;
          </button>
        </div>
      )}

      {/* Details Drawer — Host & Lead Standard Structured Inspect Drawer */}
      {detailsOpen && selectedLog && (
        <div
          className="drawer-overlay"
          style={{ zIndex: 1200 }}
          onClick={() => setDetailsOpen(false)}
        >
          <div className="audit-details-drawer" onClick={(e) => e.stopPropagation()}>
            {/* Radiant Gradient Header */}
            <div className="audit-drawer-header">
              <div className="audit-header-left">
                <div className="audit-header-icon-box">
                  <Shield size={22} />
                </div>
                <div className="audit-header-text">
                  <h2 className="audit-header-title">Audit Record Details</h2>
                  <p className="audit-header-subtitle">Full event context, actor, and execution metadata</p>
                </div>
              </div>
              <button
                type="button"
                className="audit-header-close-btn"
                onClick={() => setDetailsOpen(false)}
                aria-label="Close details drawer"
              >
                <X size={18} />
              </button>
            </div>

            {/* Scrollable Body */}
            <div className="audit-drawer-body">
              {/* 1. Overview & Event Timeline (Two-Column Layout) */}
              <section className="audit-drawer-section">
                <div className="audit-overview-timeline-grid">
                  {/* Left Column: Overview */}
                  <div className="audit-overview-col">
                    <h3 className="audit-drawer-section-title">
                      <LayoutGrid size={12} />
                      Overview
                    </h3>
                    <dl className="audit-detail-list">
                      {/* Service */}
                      <div className="audit-detail-row">
                        <span className="audit-detail-icon">
                          <Layers size={15} />
                        </span>
                        <div className="audit-detail-row-body">
                          <dt className="audit-detail-row-label">Service</dt>
                          <dd className="audit-detail-row-value">
                            <span className="audit-badge audit-badge-primary">
                              Customer360Service
                            </span>
                          </dd>
                        </div>
                      </div>

                      {/* Action */}
                      <div className="audit-detail-row">
                        <span className="audit-detail-icon audit-detail-icon-neutral">
                          <Activity size={15} />
                        </span>
                        <div className="audit-detail-row-body">
                          <dt className="audit-detail-row-label">Action</dt>
                          <dd className="audit-detail-row-value">
                            <span className="audit-action-badge">
                              {selectedLog.action || 'PROFILE.VIEW'}
                            </span>
                          </dd>
                        </div>
                      </div>

                      {/* Result */}
                      <div className="audit-detail-row">
                        <span
                          className={`audit-detail-icon ${
                            isSuccess ? 'audit-detail-icon-success' : 'audit-detail-icon-danger'
                          }`}
                        >
                          {isSuccess ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                        </span>
                        <div className="audit-detail-row-body">
                          <dt className="audit-detail-row-label">Result</dt>
                          <dd className="audit-detail-row-value">
                            <span
                              className={`audit-badge ${
                                isSuccess ? 'audit-badge-success' : 'audit-badge-danger'
                              }`}
                            >
                              <span className="audit-badge-dot" />
                              {isSuccess ? 'Success' : selectedLog.status || 'Failed'}
                            </span>
                          </dd>
                        </div>
                      </div>

                      {/* Timestamp */}
                      <div className="audit-detail-row">
                        <span className="audit-detail-icon audit-detail-icon-purple">
                          <Clock size={15} />
                        </span>
                        <div className="audit-detail-row-body">
                          <dt className="audit-detail-row-label">Timestamp</dt>
                          <dd className="audit-detail-row-value">
                            {formatAuditTimestamp(selectedLog.timestamp)}
                          </dd>
                        </div>
                      </div>
                    </dl>
                  </div>

                  {/* Right Column: Event Timeline */}
                  <div className="audit-overview-col audit-overview-col-divider">
                    <h3 className="audit-drawer-section-title">
                      <Clock size={12} />
                      Event Timeline
                    </h3>
                    <div className="audit-timeline">
                      <div className="audit-timeline-step">
                        <span className="audit-timeline-dot" />
                        <div className="audit-timeline-step-card">
                          <span className="audit-timeline-label">
                            Triggered by {selectedLog.user || 'System Officer'}
                          </span>
                          <span className="audit-timeline-time">
                            <Clock size={12} />
                            {formatAuditTimestamp(selectedLog.timestamp)}
                          </span>
                        </div>
                      </div>

                      <div className="audit-timeline-step">
                        <span
                          className={`audit-timeline-dot ${
                            isSuccess ? 'audit-timeline-dot-success' : 'audit-timeline-dot-danger'
                          }`}
                        />
                        <div className="audit-timeline-step-card">
                          <span className="audit-timeline-label">
                            {isSuccess ? 'Event Completed Successfully' : 'Event Execution Failed'}
                          </span>
                          <span className="audit-timeline-time">
                            <ShieldCheck size={12} />
                            Customer 360 CRM
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/* 2. Actor & Authentication Context */}
              <section className="audit-drawer-section">
                <h3 className="audit-drawer-section-title">
                  <User size={12} />
                  Actor &amp; Authentication Context
                </h3>
                <div className="audit-field-card-grid">
                  <div className="audit-field-card">
                    <span className="audit-field-card-icon">
                      <User size={15} />
                    </span>
                    <div className="audit-field-card-body">
                      <span className="audit-field-card-label">Actor / Officer Name</span>
                      <div className="audit-field-card-value">
                        <div className="audit-user-chip">
                          <span className="audit-user-avatar">{actorInitial}</span>
                          <span>{selectedLog.user || 'System Officer'}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="audit-field-card">
                    <span className="audit-field-card-icon">
                      <Shield size={15} />
                    </span>
                    <div className="audit-field-card-body">
                      <span className="audit-field-card-label">Access Channel</span>
                      <span className="audit-field-card-value">
                        <span className="audit-badge audit-badge-primary">
                          CRM Core Access
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="audit-field-card">
                    <span className="audit-field-card-icon">
                      <Globe size={15} />
                    </span>
                    <div className="audit-field-card-body">
                      <span className="audit-field-card-label">Client IP (IPv4)</span>
                      <span className="audit-field-card-value">
                        <span className="audit-ip-badge">
                          <span className="audit-ip-dot" />
                          127.0.0.1
                        </span>
                      </span>
                    </div>
                  </div>
                </div>
              </section>

              {/* 3. Target Customer & Entity Context */}
              <section className="audit-drawer-section">
                <h3 className="audit-drawer-section-title">
                  <Box size={12} />
                  Target Customer &amp; Entity Context
                </h3>
                <div className="audit-field-card-grid">
                  <div className="audit-field-card">
                    <span className="audit-field-card-icon">
                      <User size={15} />
                    </span>
                    <div className="audit-field-card-body">
                      <span className="audit-field-card-label">Customer Name</span>
                      <span className="audit-field-card-value" style={{ fontWeight: 600 }}>
                        {selectedLog.customerName || 'General / System Scope'}
                      </span>
                    </div>
                  </div>

                  <div className="audit-field-card">
                    <span className="audit-field-card-icon">
                      <Layers size={15} />
                    </span>
                    <div className="audit-field-card-body">
                      <span className="audit-field-card-label">Customer Type</span>
                      <span className="audit-field-card-value">
                        <span className="audit-badge audit-badge-primary">
                          {selectedLog.customerType || 'Individual Profile'}
                        </span>
                      </span>
                    </div>
                  </div>

                  <div className="audit-field-card">
                    <span className="audit-field-card-icon">
                      <Target size={15} />
                    </span>
                    <div className="audit-field-card-body">
                      <span className="audit-field-card-label">Target Field / Attribute</span>
                      <span className="audit-field-card-value">
                        {selectedLog.field || 'Full Profile View'}
                      </span>
                    </div>
                  </div>

                  <div className="audit-field-card audit-field-card-full">
                    <span className="audit-field-card-icon">
                      <FileText size={15} />
                    </span>
                    <div className="audit-field-card-body">
                      <span className="audit-field-card-label">Event Description</span>
                      <span className="audit-field-card-value">
                        {selectedLog.description || 'No description provided.'}
                      </span>
                    </div>
                  </div>
                </div>
              </section>

            </div>

            {/*
              Sticky Footer — the raw JSON payload dump, the "Copy JSON"/"Copy ID" controls and the
              truncated record GUID were removed: this drawer is read by business users reviewing
              who did what, and internal identifiers are noise they cannot act on. Everything
              meaningful is already presented as labelled fields above.
            */}
            <div className="audit-drawer-footer">
              <button
                type="button"
                className="audit-footer-close-btn"
                onClick={() => setDetailsOpen(false)}
              >
                Close Details
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
