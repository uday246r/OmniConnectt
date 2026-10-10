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
  LayoutGrid,
} from '@omniconnect/ui/icons';
import { api, ApiError } from '../services/api';
import type { AuditLog } from '../types/api';
import { getFriendlyErrorMessage } from '../utils/errorMessages';
import styles from './AuditLogs.module.css';
import cc from '../shared/c360Common.module.css';
import { ActorCell, Badge, Button, ColumnFilter, CsvExportError, DataTable, DateRangeColumnFilter, DetailField, DetailGrid, DetailSection, DetailSections, Drawer, EMPTY_DATE_RANGE, EMPTY_VALUE, FilterBar, PageHeader, Pagination, ResponsiveRows, RowAction, RowsPerPage, SearchField, describeTruncation, formatAuditTimestamp, readStoredPageSize, resolveDateRange, useDebouncedValue, type ActiveFilter, type BadgeTone, type DateRangeValue } from '@omniconnect/ui';
import { remoteDownloadCsv } from '../services/exportCsv';
import { API_BASE_URL } from '../services/api';
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

  // Filter states. `searchQuery` used to feed the fetch effect directly, so every keystroke fired a
  // fresh GET /v1/audit — typing "search" sent six uncancelled requests. The input stays bound to
  // the raw, un-debounced value so typing itself never feels laggy; only the request waits.
  const [searchInput, setSearchInput] = useState('');
  const searchQuery = useDebouncedValue(searchInput, 300);
  const [actionFilter, setActionFilter] = useState('');
  // The shared date range, held as a preset so it keeps meaning what it says over time.
  const [dateRange, setDateRange] = useState<DateRangeValue>(EMPTY_DATE_RANGE);
  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  // Status, actor, customer and description are query parameters like `action` and `search` —
  // they were filtered here over the page already fetched, which left matches on other pages
  // unreachable and the export ignoring them. See AuditQuery on the server.
  const [statusFilter, setStatusFilter] = useState('');
  const [actorFilter, setActorFilter] = useState('');
  const [customerFilter, setCustomerFilter] = useState('');
  const [descFilter, setDescFilter] = useState('');

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

  /**
   * Every filter on this screen, as the query the server applies — shared by the list and the
   * export so the CSV always answers the question the table is answering.
   */
  const filterQuery = () => ({
    search: searchQuery || undefined,
    action: actionFilter || undefined,
    status: statusFilter || undefined,
    actor: actorFilter || undefined,
    customer: customerFilter || undefined,
    description: descFilter || undefined,
    // Resolved at the point of use, so a preset keeps meaning what it says rather than freezing
    // into whichever window it happened to denote when it was picked.
    ...resolveDateRange(dateRange),
  });

  /*
   * Actor options. A row written before the actor-name fix stores "User <id>", and even when the
   * host can put a name to that id the server only knows the id — so the option filters by id and
   * shows the name.
   */
  const actorOptions = React.useMemo(() => {
    const seen = new Map<string, { value: string; label: string }>();
    for (const log of logs) {
      const actor = resolveActor(log.user);
      const value = (actor.id ?? log.user ?? '').trim();
      if (value && !seen.has(value.toLowerCase())) {
        seen.set(value.toLowerCase(), { value, label: actor.name ?? value });
      }
    }
    return [...seen.values()].sort((a, b) => a.label.localeCompare(b.label));
  }, [logs]);
  const customerOptions = React.useMemo(
    () => distinct((l) => l.customerName || l.customerId),
    [logs]
  );

  /*
   * Description recommendations, from the page of logs already loaded. The SUGGESTIONS narrow to
   * this page; the FILTER itself is applied by the server across the whole trail. Actor qualifies
   * otherwise near-identical descriptions.
   */
  const descPool = React.useMemo(
    () =>
      logs.map((l) => ({
        value: l.description ?? '',
        meta: resolveActor(l.user).name ?? l.user ?? undefined,
      })),
    [logs]
  );

  // Recommends matching rows from the currently-loaded page as the operator types, rather than
  // leaving them to guess and press Enter — the same treatment the Name/Mobile column filters on
  // the Users page have. Picking one narrows to that row's officer or customer.
  const searchSuggestions = React.useMemo(() => {
    const needle = searchQuery.trim().toLowerCase();
    if (!needle) return [];
    return logs
      .filter((log) => {
        const actor = resolveActor(log.user);
        return (
          (actor.name ?? log.user ?? '').toLowerCase().includes(needle) ||
          (log.customerName ?? log.customerId ?? '').toLowerCase().includes(needle) ||
          (log.description ?? '').toLowerCase().includes(needle)
        );
      })
      .slice(0, 8)
      .map((log) => {
        const actor = resolveActor(log.user);
        const value = actor.name ?? log.customerName ?? log.customerId ?? log.user ?? '';
        return {
          id: value,
          label: (
            <span className={styles.suggestionRow}>
              <span className={styles.suggestionPrimary}>{actor.name ?? 'System'}</span>
              <span className={styles.suggestionSecondary}>
                {log.customerName || log.customerId ? `${log.customerName || log.customerId} · ` : ''}
                {log.description}
              </span>
            </span>
          ),
        };
      });
  }, [logs, searchQuery]);

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

  /**
   * `fresh` is what the Refresh button passes. Reads of /v1/audit are reusable for 30s, so an
   * unforced refetch with unchanged filters never left the browser.
   */
  const fetchLogs = async (options?: { fresh?: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const res = await api.getAuditLogs({ ...filterQuery(), pageNumber, pageSize, fresh: options?.fresh });
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

  // Any filter change returns to page 1. The date range and the four formerly client-side filters
  // were missing here, so narrowing from page 5 could land on an empty page 5 of a shorter result.
  useEffect(() => {
    setPageNumber(1);
  }, [searchQuery, actionFilter, statusFilter, actorFilter, customerFilter, descFilter, dateRange]);

  useEffect(() => {
    fetchLogs();
  }, [pageNumber, pageSize, actionFilter, searchQuery, dateRange, statusFilter, actorFilter, customerFilter, descFilter]);

  /**
   * Exports the whole filtered trail, from the server.
   *
   * @remarks
   * The version this replaces re-fetched with `pageSize: 1000` and built the CSV here — and the list
   * endpoint clamps page size to 100, as it must, so "export everything" had always meant "export at
   * most a hundred rows". The file said otherwise, and nothing anywhere reported the difference.
   *
   * The export endpoint has its own, much larger cap and reports when it reaches it.
   */
  const handleExportCSV = async () => {
    setExporting(true);
    setExportNotice(null);
    try {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filterQuery())) {
        if (value) query.append(key, value);
      }

      const result = await remoteDownloadCsv(
        `${API_BASE_URL}/v1/audit/export?${query.toString()}`,
        `customer360-audit-logs-${new Date().toISOString().split('T')[0]}.csv`,
      );

      setExportNotice(describeTruncation(result));
    } catch (err) {
      setExportNotice(
        err instanceof CsvExportError ? err.message : 'The audit log could not be exported.',
      );
    } finally {
      setExporting(false);
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
              disabled={exporting}
              leadingIcon={<Download size={15} />}
            >
              {exporting ? 'Exporting…' : 'Export CSV'}
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
          actorFilter && {
            key: 'actor',
            label: 'Performed By',
            // The filter value may be an id (see actorOptions); the chip shows the name for it.
            value: actorOptions.find((o) => o.value === actorFilter)?.label ?? actorFilter,
            onRemove: () => setActorFilter(''),
          },
          customerFilter && { key: 'customer', label: 'Customer', value: customerFilter, onRemove: () => setCustomerFilter('') },
          statusFilter && {
            key: 'status',
            label: 'Status',
            value: STATUS_FILTER_OPTIONS.find((o) => o.value === statusFilter)?.label ?? statusFilter,
            onRemove: () => setStatusFilter(''),
          },
          descFilter && { key: 'desc', label: 'Description', value: `"${descFilter}"`, onRemove: () => setDescFilter('') },
          searchQuery && { key: 'search', label: 'Search', value: `"${searchQuery}"`, onRemove: () => setSearchInput('') },
        ].filter(Boolean) as ActiveFilter[]}
        onClearAll={() => {
          setActionFilter('');
          setActorFilter('');
          setCustomerFilter('');
          setDescFilter('');
          setStatusFilter('');
          setSearchInput('');
        }}
      />

      {/* Main Table Card — same shell as the host's Users page and lead_mf's card+toolbar
          composition (`cc.card`), not the older `.c360-table-container` this page used before. */}
      <div className={cc.card}>
        {/* Controls Toolbar */}
        <div className={cc.toolbar}>
          <div className={cc.toolbarSearch}>
            <SearchField
              placeholder="Search audit trail by officer, customer, or description..."
              value={searchInput}
              onValueChange={setSearchInput}
              suggestions={searchSuggestions}
              onSelectSuggestion={(s) => setSearchInput(s.id)}
              emptyHint="No matches in the loaded page."
            />
          </div>

          <div className={cc.toolbarActions}>
          {/* Rows-per-page belongs with the table controls, not in the footer — the host's Audit
              Logs is the reference for both the placement and the "ROWS" label. */}
          <RowsPerPage storageKey="c360.audit" value={pageSize} onChange={(n) => { setPageSize(n); setPageNumber(1); }} />

          <Button
            variant="secondary"
            size="sm"
            onClick={() => void fetchLogs({ fresh: true })}
            disabled={loading}
            leadingIcon={<RefreshCw size={14} className={loading ? 'animate-spin' : ''} />}
          >
            Refresh
          </Button>
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
          A capped or refused export, reported rather than swallowed. The previous export logged its
          failures to the console and silently truncated its successes, so neither outcome reached
          the person who asked for the file.
        */}
        {exportNotice && (
          <div className={styles.row4} role="status">
            <AlertTriangle size={18} className={styles.rule2} />
            <span>{exportNotice}</span>
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
        <DataTable bare footer={<Pagination page={pageNumber} pageSize={pageSize} total={totalCount} itemLabel="event" onPageChange={setPageNumber} />}>
            <ResponsiveRows
              loading={loading && logs.length === 0}
              loadingRows={pageSize}
              rows={logs}
              rowKey={(log, i) => String(log.id ?? i)}
              empty={
                searchQuery || actionFilter || actorFilter || customerFilter || descFilter || statusFilter
                  ? 'No audit logs match the selected filters. Try clearing filters or adjusting your search query.'
                  : 'No customer audit events recorded yet.'
              }
              columns={[
                {
                  key: 'timestamp',
                  label: 'Date & Time',
                  priority: 'always',
                  // The date filter this screen never had — and could not have had. The column it
                  // filters on was local wall-clock TEXT until the migration that turned it into a
                  // real instant, so there was nothing to compare a range against.
                  header: (
                    <DateRangeColumnFilter
                      key="timestamp"
                      label="Date & Time"
                      value={dateRange}
                      onChange={setDateRange}
                    />
                  ),
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
                      filterType="alpha"
                      searchPlaceholder="Type a name to narrow…"
                      emptyHint="Nobody in this log matches that."
                    />
                  ),
                  render: (log) => {
                    const actor = resolveActor(log.user);
                    return (
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
                      title="Filter Action"
                      value={actionFilter}
                      onChange={setActionFilter}
                      options={ACTION_FILTER_OPTIONS}
                      allLabel="All Actions"
                      searchPlaceholder="Type to filter actions…"
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
                      filterType="alpha"
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
                  header: (
                    <ColumnFilter
                      key="description"
                      label="Description"
                      title="Filter Description"
                      value={descFilter}
                      onChange={setDescFilter}
                      options={[]}
                      allLabel={undefined}
                      freeText
                      searchPlaceholder="Type to filter description…"
                      suggestFrom={descPool}
                      emptyHint="No matching activity on this page."
                    />
                  ),
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
                      title="Filter Outcome"
                      value={statusFilter}
                      onChange={setStatusFilter}
                      options={STATUS_FILTER_OPTIONS}
                      allLabel="All Outcomes"
                      searchPlaceholder="Type to filter outcome…"
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
      </div>


      {/* Details Drawer — Host & Lead Standard Structured Inspect Drawer */}
      {detailsOpen && selectedLog && (
        <Drawer
          open={detailsOpen}
          onClose={() => setDetailsOpen(false)}
          title="Activity Details"
          subtitle="What happened, who did it, and when"
          icon={<Shield size={20} />}
          closeLabel="Close details"
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
                            <Badge tone="primary">{formatActionLabel(selectedLog.action)}</Badge>
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
                              {isSuccess ? 'Success' : 'Failure'}
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
                title="Affected Record"
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
