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
import styles from './AuditLogs.module.css';
import cc from '../shared/c360Common.module.css';
import { ActorCell, Badge, Button, ColumnFilter, DataTable, EMPTY_VALUE, FilterBar, PageHeader, Pagination, RowAction, RowsPerPage, SearchField, formatAuditTimestamp, readStoredPageSize, type ActiveFilter, type BadgeTone } from '@omniremit/ui';
import { resolveActor, shortId } from '../shared/resolveActor';

/* Action -> platform badge tone. Was four hardcoded {bg,text,border,dot} palettes handed to the
   pill through inline custom properties; the tones carry the same colours from the token set. */
const actionTone = (action?: string): BadgeTone => {
  const a = (action || '').toLowerCase();
  if (a.includes('create') || a.includes('add') || a.includes('insert')) return 'success';
  if (a.includes('delete') || a.includes('remove') || a.includes('purge')) return 'danger';
  return 'primary';
};

/** A row's own outcome. Success unless the record says otherwise. */
const isSuccessStatus = (status?: string) => {
  const v = (status || '').toUpperCase();
  return v === '' || v === 'SUCCESS';
};

function getActorInitial(name?: string | null): string {
  if (!name) return 'S';
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.charAt(0) || 'S').toUpperCase();
}

/* The vocabulary the Action column filters on. Was a toolbar <select>; the host puts this control
   in the column header instead, which is where it now lives. */
const STATUS_FILTER_OPTIONS = [
  { value: 'SUCCESS', label: 'Success' },
  { value: 'FAILED', label: 'Failed' },
];

const ACTION_FILTER_OPTIONS = [
  { value: 'VIEW', label: 'View Profile' },
  { value: 'LOOKUP', label: 'Lookup Search' },
  { value: 'UPDATE', label: 'Profile Update' },
  { value: 'EXPORT', label: 'Data Export' },
];

export default function AuditLogs() {
  const [logs, setLogs] = useState<AuditLog[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Pagination states
  const [pageNumber, setPageNumber] = useState(1);
  // Opens at whatever size this user last chose here.
  const [pageSize, setPageSize] = useState(() => readStoredPageSize('c360.audit', 10));
  const [totalCount, setTotalCount] = useState(0);
  const [totalPages, setTotalPages] = useState(1);

  // Filter states
  const [searchQuery, setSearchQuery] = useState('');
  const [actionFilter, setActionFilter] = useState('');
  // Status has no server-side parameter, so it narrows the page already fetched. Kept explicit so
  // nobody later assumes it paginates like `action` and `search` do.
  const [statusFilter, setStatusFilter] = useState('');
  // Client-side, like status: GET /v1/audit accepts `search` and `action` only, so these narrow the
  // page already fetched rather than the query.
  const [actorFilter, setActorFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');

  /*
   * Actor and Customer offer the values that ACTUALLY appear in the loaded audit rows, so the list
   * can never suggest something that returns nothing. Typing narrows it. Both were empty
   * type-to-search boxes, which told you nothing about who or what was in the data.
   */
  const distinct = (pick: (l: AuditLog) => string | null | undefined) => {
    const seen = new Map<string, string>();
    for (const log of logs) {
      const v = (pick(log) ?? '').trim();
      if (v && !seen.has(v.toLowerCase())) seen.set(v.toLowerCase(), v);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b)).map((v) => ({ value: v, label: v }));
  };

  /*
   * Status, Actor and Customer filter CLIENT-SIDE — GET /v1/audit accepts `search` and `action`
   * only — while paging is server-side. With a client filter on, the pager would claim
   * "Showing 11 to 13 of 13" above rows that had all been filtered out. It now describes what is
   * on screen instead, and server paging is suppressed while one is active.
   */
  const visibleLogs = logs.filter((log) => {
    if (statusFilter && (isSuccessStatus(log.status) ? 'SUCCESS' : 'FAILED') !== statusFilter) return false;
    if (actorFilter) {
      const actor = resolveActor(log.user);
      const hay = `${actor.name ?? ''} ${actor.id ?? ''} ${log.user ?? ''}`.toLowerCase();
      if (!hay.includes(actorFilter.toLowerCase())) return false;
    }
    if (customerFilter) {
      const hay = `${log.customerName ?? ''} ${log.customerId ?? ''}`.toLowerCase();
      if (!hay.includes(customerFilter.toLowerCase())) return false;
    }
    return true;
  });
  const clientFiltered = Boolean(statusFilter || actorFilter || customerFilter);

  const actorOptions = React.useMemo(
    () => distinct((l) => resolveActor(l.user).name ?? l.user),
    [logs]
  );
  const customerOptions = React.useMemo(
    () => distinct((l) => l.customerName || l.customerId),
    [logs]
  );

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
  const resolvedActor = resolveActor(selectedLog?.user);
  const actorName = resolvedActor.name ?? (resolvedActor.id ? `Officer ${shortId(resolvedActor.id)}` : 'System Officer');
  const actorInitial = getActorInitial(actorName);

  return (
    <div className={styles.stack}>
      {/* Hero Banner — Host Pattern */}
      <PageHeader
        icon={<ShieldCheck size={24} />}
        title="Customer 360° Audit Trail"
        pill={`${totalCount || logs.length} Events Logged`}
        subtitle="Immutable compliance and security logs of all customer profile lookups, views, and data access events"
        actions={
          <Button
            variant="onHeader"
            onClick={handleExportCSV}
            disabled={logs.length === 0}
            leadingIcon={<Download size={15} />}
          >
            Export CSV
          </Button>
        }
      />

      <FilterBar
        filters={[
          actionFilter && {
            key: 'action',
            label: 'Action',
            value: ACTION_FILTER_OPTIONS.find((o) => o.value === actionFilter)?.label ?? actionFilter,
            onRemove: () => setActionFilter(''),
          },
          actorFilter && { key: 'actor', label: 'Performed By', value: actorFilter, onRemove: () => setActorFilter('') },
          customerFilter && { key: 'customer', label: 'Customer', value: customerFilter, onRemove: () => setCustomerFilter('') },
          statusFilter && {
            key: 'status',
            label: 'Status',
            value: STATUS_FILTER_OPTIONS.find((o) => o.value === statusFilter)?.label ?? statusFilter,
            onRemove: () => setStatusFilter(''),
          },
          searchQuery && { key: 'search', label: 'Search', value: `"${searchQuery}"`, onRemove: () => setSearchQuery('') },
        ].filter(Boolean) as ActiveFilter[]}
        onClearAll={() => {
          setActionFilter('');
          setActorFilter('');
          setCustomerFilter('');
          setStatusFilter('');
          setSearchQuery('');
        }}
      />

      {/* Main Table Card */}
      <div className="c360-table-container">
        {/* Controls Toolbar */}
        <div className={cc.toolbar}
        >
          <div className={cc.toolbarSearch}>
            <div className={styles.rule}>
              <SearchField
                placeholder="Search audit trail by officer, customer, or description..."
                value={searchQuery}
                onValueChange={setSearchQuery}
              />
            </div>

          </div>

          <div className={cc.toolbarActions}>
          {/* Rows-per-page belongs with the table controls, not in the footer — the host's Audit
              Logs is the reference for both the placement and the "ROWS" label. */}
          <RowsPerPage storageKey="c360.audit" value={pageSize} onChange={(n) => { setPageSize(n); setPageNumber(1); }} />

          <button
            type="button"
            onClick={fetchLogs}
            disabled={loading}
            className={styles.panel}
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            <span>Refresh</span>
          </button>
        </div>
        </div>

        {/* Error Banner */}
        {error && (
          <div className={styles.row4}>
            <AlertTriangle size={18} className={styles.rule2} />
            <span>{error}</span>
          </div>
        )}

        {/* Table / Empty State */}
        {loading && logs.length === 0 ? (
          <div className={styles.text}>
            <RefreshCw size={24} className={`animate-spin ${styles.text2}`} />
            <p className={styles.rule3}>Loading Customer 360° audit logs...</p>
          </div>
        ) : logs.length === 0 ? (
          <div className={styles.text3}>
            <ShieldCheck size={36} className={styles.muted} />
            <h3 className={styles.text4}>No audit logs found</h3>
            <p className={styles.text5}>
              {searchQuery || actionFilter ? 'Try clearing filters or search queries.' : 'No customer audit events recorded yet.'}
            </p>
          </div>
        ) : (
          <DataTable>
              <thead>
                <tr>
                  <th>Date &amp; Time</th>
                  <ColumnFilter
                    label="Performed By"
                    title="Filter Performed By"
                    value={actorFilter}
                    onChange={setActorFilter}
                    options={actorOptions}
                    allLabel="Everyone"
                    searchable={actorOptions.length > 6}
                    searchPlaceholder="Type a name to narrow…"
                    emptyHint="Nobody in this log matches that."
                  />
                  <ColumnFilter
                    label="Action"
                    value={actionFilter}
                    onChange={setActionFilter}
                    options={ACTION_FILTER_OPTIONS}
                    allLabel="All Actions"
                  />
                  <ColumnFilter
                    label="Customer Reference"
                    title="Filter Customer"
                    value={customerFilter}
                    onChange={setCustomerFilter}
                    options={customerOptions}
                    allLabel="All Customers"
                    searchable={customerOptions.length > 6}
                    searchPlaceholder="Type to narrow customers…"
                    emptyHint="No customer in this log matches that."
                  />
                  <th>What Happened</th>
                  <ColumnFilter
                    label="Status"
                    value={statusFilter}
                    onChange={setStatusFilter}
                    options={STATUS_FILTER_OPTIONS}
                    allLabel="All Statuses"
                  />
                  <th className={styles.rule4}>Details</th>
                </tr>
              </thead>
              <tbody>
                {visibleLogs.map((log, idx) => {
                  // Per ROW. This previously read the component-level `isSuccess`, which is derived
                  // from `selectedLog` — the drawer's record — so every row in the table rendered
                  // the status of whichever log happened to be selected.
                  const rowSuccess = isSuccessStatus(log.status);

                  return (
                    <tr
                      key={idx}
                      className={styles.rule5}
                    >
                      <td className={styles.text6}>
                        {formatAuditTimestamp(log.timestamp)}
                      </td>
                      <td>
                        {(() => {
                          const actor = resolveActor(log.user);
                          return (
                            <ActorCell
                              name={actor.name ?? (actor.id ? null : 'System')}
                              fallback={actor.id ? shortId(actor.id) : undefined}
                            />
                          );
                        })()}
                      </td>
                      <td>
                        <Badge tone={actionTone(log.action)} dot>
                          {(log.action || 'VIEW').toUpperCase()}
                        </Badge>
                      </td>
                      {/* Customer reference. When there is no name — a failed lookup, a
                          system-scope event — the identifier IS the reference, so it becomes the
                          primary line instead of rendering a bare "-" above it. */}
                      <td>
                        {log.customerName ? (
                          <>
                            <div className={styles.text7}>{log.customerName}</div>
                            {log.customerId && <div className={cc.monoMeta}>{log.customerId}</div>}
                          </>
                        ) : log.customerId ? (
                          <div className={cc.monoMeta}>{log.customerId}</div>
                        ) : (
                          <span className={cc.mutedText}>{EMPTY_VALUE}</span>
                        )}
                      </td>
                      <td className={styles.text8}>{log.description || '-'}</td>
                      <td>
                        <Badge tone={rowSuccess ? 'success' : 'danger'} dot>
                          {log.status || 'Success'}
                        </Badge>
                      </td>
                      <td className={styles.rule4}>
                        <RowAction
                          onClick={(e) => {
                            e.stopPropagation();
                            setSelectedLog(log);
                            setDetailsOpen(true);
                          }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </DataTable>
        )}
      </div>

      <Pagination
        page={clientFiltered ? 1 : pageNumber}
        pageSize={clientFiltered ? Math.max(visibleLogs.length, 1) : pageSize}
        total={clientFiltered ? visibleLogs.length : totalCount}
        itemLabel="event"
        onPageChange={setPageNumber}
      />


      {/* Details Drawer — Host & Lead Standard Structured Inspect Drawer */}
      {detailsOpen && selectedLog && (
        <div
          className={`drawer-overlay ${styles.rule6}`}
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
                            <Badge tone="primary">
                              Customer360Service
                              </Badge>
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
                            <Badge tone={isSuccess ? 'success' : 'danger'} dot>
                              {isSuccess ? 'Success' : selectedLog.status || 'Failed'}
                            </Badge>
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
                            Triggered by {actorName}
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
                          <span>{actorName}</span>
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
                        <Badge tone="primary">
                          CRM Core Access
                          </Badge>
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
                      <span className={`audit-field-card-value ${styles.rule7}`}>
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
                        <Badge tone="primary">
                          {selectedLog.customerType || 'Individual Profile'}
                          </Badge>
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
              <Button type="button" variant="secondary" onClick={() => setDetailsOpen(false)}>
                Close Details
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
