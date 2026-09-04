import { canExportAuditLogs } from '../api/hostBridge';
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
  Box,
  Copy,
  Check,
  LayoutGrid,
} from '@omniremit/ui/icons';
import { api, ApiError } from '../services/api';
import type { AuditLog } from '../types/api';
import { getFriendlyErrorMessage } from '../utils/errorMessages';
import styles from './AuditLogs.module.css';
import cc from '../shared/c360Common.module.css';
import { ActorCell, Badge, Button, ColumnFilter, DataTable, DetailField, DetailGrid, DetailSection, DetailSections, Drawer, EMPTY_VALUE, FilterBar, PageHeader, Pagination, ResponsiveRows, RowAction, RowsPerPage, SearchField, formatAuditTimestamp, readStoredPageSize, type ActiveFilter, type BadgeTone } from '@omniremit/ui';
import { resolveActor } from '../shared/resolveActor';

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

/*
 * The raw action code (VIEW, LOOKUP, PROFILE.UPDATE) is what the API stores; ACTION_FILTER_OPTIONS
 * already carries the plain-English name for each. Using it here means the table, the filter chips
 * and the details drawer all say the same human-readable thing instead of shouting a code.
 */
const formatActionLabel = (action?: string | null): string => {
  if (!action) return 'Activity';
  const known = ACTION_FILTER_OPTIONS.find((o) => o.value === action.toUpperCase());
  if (known) return known.label;
  const segment = action.includes('.') ? action.slice(action.lastIndexOf('.') + 1) : action;
  return segment
    .replace(/_/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
};

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
  /*
   * Stays null when the name cannot be resolved, so the Performed By field is omitted
   * entirely. It previously rendered a truncated database GUID as though it were a name
   * ("Officer 1a2b3c"), or the invented title 'System Officer'.
   */
  const actorName = resolvedActor.name;
  const actorInitial = actorName ? getActorInitial(actorName) : '';

  return (
    <div className={styles.stack}>
      {/* Hero Banner — Host Pattern */}
      <PageHeader
        icon={<ShieldCheck size={24} />}
        title="Customer 360° Audit Trail"
        pill={`${totalCount || logs.length} Events Logged`}
        subtitle="Immutable compliance and security logs of all customer profile lookups, views, and data access events"
        actions={
          /*
           * A UI gate, not a data boundary — the CSV is built here from rows already fetched under
           * audit:View, so withholding the button withholds one click's convenience, not the rows.
           * Worth granting separately because an export leaves the platform; not something to rely
           * on for who can read the log. The manifest says the same beside the declaration.
           */
          canExportAuditLogs() ? (
            <Button
              variant="onHeader"
              onClick={handleExportCSV}
              disabled={logs.length === 0}
              leadingIcon={<Download size={15} />}
            >
              Export CSV
            </Button>
          ) : null
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

        {/*
          * Table / Empty State.
          *
          * The table uses priority columns + a row expander: as the window narrows, What Happened
          * and Customer Reference drop out first and each row grows a chevron revealing them
          * underneath, rather than the table scrolling sideways with half its columns off screen.
          * `minWidth` is deliberately gone — the point is that it no longer needs a scroller.
          */}
        {logs.length === 0 && !loading ? (
          <div className={styles.text3}>
            <ShieldCheck size={36} className={styles.muted} />
            <h3 className={styles.text4}>No audit logs found</h3>
            <p className={styles.text5}>
              {searchQuery || actionFilter ? 'Try clearing filters or search queries.' : 'No customer audit events recorded yet.'}
            </p>
          </div>
        ) : (
          <DataTable>
            <ResponsiveRows
              loading={loading && logs.length === 0}
              loadingRows={pageSize}
              rows={visibleLogs}
              rowKey={(log, i) => String(log.id ?? i)}
              empty="No audit records found matching the selected filters."
              columns={[
                {
                  key: 'timestamp',
                  label: 'Date & Time',
                  priority: 'always',
                  render: (log) => (
                    <span className={styles.text6}>{formatAuditTimestamp(log.timestamp)}</span>
                  ),
                },
                {
                  key: 'actor',
                  label: 'Performed By',
                  priority: 'always',
                  header: (
                    <ColumnFilter
                      key="actor"
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
                  ),
                  render: (log) => {
                    const actor = resolveActor(log.user);
                    return (
                      /*
                       * No raw identifier here. The fallback used to be shortId(actor.id) — a
                       * truncated database GUID, meaningless to the people who read this log. When
                       * the name cannot be resolved, saying so plainly is more useful.
                       */
                      <ActorCell
                        name={actor.name ?? (actor.id ? null : 'System')}
                        fallback="Unknown user"
                      />
                    );
                  },
                },
                {
                  key: 'action',
                  label: 'What Happened',
                  priority: 'always',
                  header: (
                    <ColumnFilter
                      key="action"
                      label="What Happened"
                      value={actionFilter}
                      onChange={setActionFilter}
                      options={ACTION_FILTER_OPTIONS}
                      allLabel="All Actions"
                    />
                  ),
                  render: (log) => (
                    <Badge tone={actionTone(log.action)} dot>
                      {formatActionLabel(log.action)}
                    </Badge>
                  ),
                },
                {
                  key: 'customer',
                  label: 'Customer',
                  priority: 'low',
                  header: (
                    <ColumnFilter
                      key="customer"
                      label="Customer"
                      title="Filter Customer"
                      value={customerFilter}
                      onChange={setCustomerFilter}
                      options={customerOptions}
                      allLabel="All Customers"
                      searchable={customerOptions.length > 6}
                      searchPlaceholder="Type to narrow customers…"
                      emptyHint="No customer in this log matches that."
                    />
                  ),
                  render: (log) =>
                    log.customerName ? (
                      <>
                        <div className={styles.text7}>{log.customerName}</div>
                        {log.customerId && <div className={cc.monoMeta}>{log.customerId}</div>}
                      </>
                    ) : log.customerId ? (
                      <div className={cc.monoMeta}>{log.customerId}</div>
                    ) : (
                      <span className={cc.mutedText}>{EMPTY_VALUE}</span>
                    ),
                },
                {
                  key: 'description',
                  label: 'Description',
                  priority: 'low',
                  render: (log) => <span className={styles.text8}>{log.description || EMPTY_VALUE}</span>,
                },
                {
                  key: 'status',
                  label: 'Outcome',
                  priority: 'high',
                  header: (
                    <ColumnFilter
                      key="status"
                      label="Outcome"
                      value={statusFilter}
                      onChange={setStatusFilter}
                      options={STATUS_FILTER_OPTIONS}
                      allLabel="All Outcomes"
                    />
                  ),
                  render: (log) => (
                    <Badge tone={isSuccessStatus(log.status) ? 'success' : 'danger'} dot>
                      {log.status || 'Success'}
                    </Badge>
                  ),
                },
                {
                  key: 'details',
                  label: 'Details',
                  priority: 'always',
                  align: 'right',
                  render: (log) => (
                    <RowAction
                      onClick={(e) => {
                        e.stopPropagation();
                        setSelectedLog(log);
                        setDetailsOpen(true);
                      }}
                    />
                  ),
                },
              ]}
            />
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
        <Drawer
          open={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          title="Activity Details"
          subtitle="What happened, who did it, and when"
          icon={<Shield size={22} />}
          footer={
            <Button type="button" variant="secondary" onClick={() => setDetailsOpen(false)}>
              Close Details
            </Button>
          }
        >
            <DetailSections>
              {/* Summary + timeline, side by side */}
              <section className="audit-drawer-section">
                <div className="audit-overview-timeline-grid">
                  <div className="audit-overview-col">
                    <h3 className="audit-drawer-section-title">
                      <LayoutGrid size={12} />
                      Summary
                    </h3>
                    <dl className="audit-detail-list">
                      {/*
                        Not read from the record, and not a fabrication either: every row on this
                        page is the Customer 360 audit trail, so naming the application states a
                        fact about where the event came from. It keeps the Summary block structurally
                        identical to the host and lead drawers, which both lead with it.
                      */}
                      <div className="audit-detail-row">
                        <span className="audit-detail-icon">
                          <Layers size={15} />
                        </span>
                        <div className="audit-detail-row-body">
                          <dt className="audit-detail-row-label">Application</dt>
                          <dd className="audit-detail-row-value">
                            <Badge tone="primary">Customer 360</Badge>
                          </dd>
                        </div>
                      </div>

                      <div className="audit-detail-row">
                        <span className="audit-detail-icon audit-detail-icon-neutral">
                          <Activity size={15} />
                        </span>
                        <div className="audit-detail-row-body">
                          <dt className="audit-detail-row-label">What Happened</dt>
                          <dd className="audit-detail-row-value">
                            <span className="audit-action-badge">
                              {formatActionLabel(selectedLog.action)}
                            </span>
                          </dd>
                        </div>
                      </div>

                      <div className="audit-detail-row">
                        <span
                          className={`audit-detail-icon ${
                            isSuccess ? 'audit-detail-icon-success' : 'audit-detail-icon-danger'
                          }`}
                        >
                          {isSuccess ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}
                        </span>
                        <div className="audit-detail-row-body">
                          <dt className="audit-detail-row-label">Outcome</dt>
                          <dd className="audit-detail-row-value">
                            <Badge tone={isSuccess ? 'success' : 'danger'} dot>
                              {isSuccess ? 'Successful' : selectedLog.status || 'Failed'}
                            </Badge>
                          </dd>
                        </div>
                      </div>

                      <div className="audit-detail-row">
                        <span className="audit-detail-icon audit-detail-icon-purple">
                          <Clock size={15} />
                        </span>
                        <div className="audit-detail-row-body">
                          <dt className="audit-detail-row-label">Date &amp; Time</dt>
                          <dd className="audit-detail-row-value">
                            {formatAuditTimestamp(selectedLog.timestamp)}
                          </dd>
                        </div>
                      </div>
                    </dl>
                  </div>

                  <div className="audit-overview-col audit-overview-col-divider">
                    <h3 className="audit-drawer-section-title">
                      <Clock size={12} />
                      Timeline
                    </h3>
                    <div className="audit-timeline">
                      <div className="audit-timeline-step">
                        <span className="audit-timeline-dot" />
                        <div className="audit-timeline-step-card">
                          <span className="audit-timeline-label">
                            {actorName ? `Started by ${actorName}` : 'Activity recorded'}
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
                            {isSuccess ? 'Finished successfully' : 'Did not complete'}
                          </span>
                          <span className="audit-timeline-time">
                            <ShieldCheck size={12} />
                            Customer 360
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </section>

              {/*
                Every field below disappears when the backend sends nothing for it — DetailField
                returns null rather than printing a placeholder. This section previously showed an
                "Access Channel" badge reading "CRM Core Access" and a "Client IP" of "127.0.0.1",
                both hardcoded in the markup rather than returned by the API: invented values in an
                audit trail, which is the one place they must never appear. Gone until the endpoint
                actually supplies them.
              */}
              <DetailSection title="Who Did This" icon={<User size={12} />} hidden={!actorName}>
                <DetailGrid>
                  <DetailField label="Performed By" icon={<User size={15} />}>
                    {actorName ? (
                      <span className="audit-user-chip">
                        <span className="audit-user-avatar">{actorInitial}</span>
                        <span>{actorName}</span>
                      </span>
                    ) : null}
                  </DetailField>
                </DetailGrid>
              </DetailSection>

              <DetailSection
                title="Customer & Record"
                icon={<Box size={12} />}
                hidden={
                  !selectedLog.customerName &&
                  !selectedLog.customerType &&
                  !selectedLog.field &&
                  !selectedLog.description
                }
              >
                <DetailGrid>
                  <DetailField label="Customer" icon={<User size={15} />}>
                    {selectedLog.customerName}
                  </DetailField>

                  <DetailField label="Customer Type" icon={<Layers size={15} />}>
                    {selectedLog.customerType ? (
                      <Badge tone="primary">{selectedLog.customerType}</Badge>
                    ) : null}
                  </DetailField>

                  <DetailField label="Field Changed" icon={<Target size={15} />}>
                    {selectedLog.field}
                  </DetailField>

                  <DetailField label="Description" icon={<FileText size={15} />} full>
                    {selectedLog.description}
                  </DetailField>
                </DetailGrid>
              </DetailSection>
            </DetailSections>

        </Drawer>
      )}
    </div>
  );
}
