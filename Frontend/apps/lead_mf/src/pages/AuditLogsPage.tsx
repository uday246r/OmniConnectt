import { canExportAuditLogs } from '../api/hostBridge';
import React, { useEffect, useState } from 'react';
import { ShieldCheck, Search, RefreshCw, Eye, Download, X, ChevronLeft, ChevronRight } from '@omniconnect/ui/icons';
import { ActorCell, Badge, Button, ColumnFilter, CsvExportError, DataTable, DateRangeColumnFilter, FilterBar, Icon, PageHeader, Pagination, ResponsiveRows, RowAction, RowsPerPage, SearchField, describeTruncation, formatAuditTimestamp, resolveDateRange, useDebouncedValue, type ActiveFilter } from '@omniconnect/ui';
import { remoteDownloadCsv } from '../api/exportCsv';
import { API_BASE_URL } from '../api/apiClient';
import { useLeadStore } from '../store/useLeadStore';
import styles from './AuditLogsPage.module.css';
import shell from '../shared/leadPage.module.css';
import { AuditDetailsDrawer } from '../components/audit/AuditDetailsDrawer';
import { useShallow } from 'zustand/react/shallow';

export const AuditLogsPage: React.FC = () => {
  const {
    auditLogs,
    auditSearchQuery,
    auditActionFilter,
    auditDateRange,
    setAuditDateRange,
    isLoadingAuditLogs,
    fetchAuditLogs,
    openAuditDetails,
    setAuditSearchQuery,
    setAuditActionFilter,
    auditActorFilter: actorFilter,
    setAuditActorFilter: setActorFilter,
    auditStatusFilter: statusFilter,
    setAuditStatusFilter: setStatusFilter,
    // Pagination — this state and the fetchAuditLogs page/pageSize wiring already existed in the
    // store; only the UI to drive it was missing, so only the first page (10 rows) of audit history
    // was ever reachable no matter how much existed.
    auditPage,
    auditPageSize,
    totalAuditRecords,
    setAuditPage,
    setAuditPageSize,
  } = useLeadStore(useShallow((s) => ({ auditLogs: s.auditLogs, auditSearchQuery: s.auditSearchQuery, auditActionFilter: s.auditActionFilter, auditDateRange: s.auditDateRange, setAuditDateRange: s.setAuditDateRange, isLoadingAuditLogs: s.isLoadingAuditLogs, fetchAuditLogs: s.fetchAuditLogs, openAuditDetails: s.openAuditDetails, setAuditSearchQuery: s.setAuditSearchQuery, setAuditActionFilter: s.setAuditActionFilter, auditActorFilter: s.auditActorFilter, setAuditActorFilter: s.setAuditActorFilter, auditStatusFilter: s.auditStatusFilter, setAuditStatusFilter: s.setAuditStatusFilter, auditPage: s.auditPage, auditPageSize: s.auditPageSize, totalAuditRecords: s.totalAuditRecords, setAuditPage: s.setAuditPage, setAuditPageSize: s.setAuditPageSize })));

  const totalAuditPages = Math.max(1, Math.ceil(totalAuditRecords / auditPageSize));
  const auditStartIndex = totalAuditRecords > 0 ? (auditPage - 1) * auditPageSize + 1 : 0;
  const auditEndIndex = Math.min(auditPage * auditPageSize, totalAuditRecords);

  // `setAuditSearchQuery` fires a real request immediately (see the store), so typing "administrator"
  // sent thirteen uncancelled requests. The box stays controlled by the raw, un-debounced value —
  // typing never feels laggy — and only the store (and the server call it makes) waits for the
  // debounce to settle.
  const [searchInput, setSearchInput] = useState(auditSearchQuery);
  const debouncedSearchInput = useDebouncedValue(searchInput, 300);
  useEffect(() => {
    if (debouncedSearchInput !== auditSearchQuery) setAuditSearchQuery(debouncedSearchInput);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [debouncedSearchInput]);

  /*
   * The Actor column offers the people who ACTUALLY appear in the audit log, not a free-text box
   * and not the full role list. Typing narrows the list; clicking picks one.
   *
   * The OPTIONS come from the page on screen, but the FILTER is applied by the server across the
   * whole trail — so a pick always returns every matching row, on every page, and the export
   * honours it.
   */
  const actorOptions = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const log of auditLogs) {
      const name = (log.userName || 'System').trim();
      if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b)).map((n) => ({ value: n, label: n }));
  }, [auditLogs]);

  // Recommends matching rows from the currently-loaded page as the operator types — the same
  // "show it, don't make them press Enter to find out" treatment the Name/Mobile column filters
  // have elsewhere. Picking one narrows the search to that entry's user, which is what the search
  // box actually filters by server-side.
  const searchSuggestions = React.useMemo(() => {
    const needle = debouncedSearchInput.trim().toLowerCase();
    if (!needle) return [];
    return auditLogs
      .filter(
        (log) =>
          (log.userName || '').toLowerCase().includes(needle) ||
          (log.description || '').toLowerCase().includes(needle) ||
          (log.ipAddress || '').toLowerCase().includes(needle),
      )
      .slice(0, 8)
      .map((log) => ({
        id: log.userName || log.description || '',
        label: (
          <span className={styles.suggestionRow}>
            <span className={styles.suggestionPrimary}>{log.userName || 'System'}</span>
            <span className={styles.suggestionSecondary}>{log.description}</span>
          </span>
        ),
      }));
  }, [auditLogs, debouncedSearchInput]);

  /*
   * Actor and Status used to be filtered here, in the browser, over the page already fetched —
   * while paging stayed server-side, so the pager and the table could not both be right, and
   * matches on other pages were unreachable. Both are `actor` / `status` query parameters on the
   * audit endpoint now; every row on screen is a row the server matched.
   */

  useEffect(() => {
    fetchAuditLogs();
  }, [fetchAuditLogs]);

  const [exporting, setExporting] = useState(false);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  /**
   * Exports the whole filtered trail, from the server.
   *
   * @remarks
   * This used to build the CSV here, from `auditLogs` — which is one page, ten rows by default — and
   * save it as "Audit_Trail_Logs_<today>". Nothing about the file said it was a page rather than the
   * log, so an export taken as evidence was almost always missing nearly all of it.
   *
   * The server now assembles it from the same filters this screen is showing, and reports when it
   * had to cap the result rather than quietly serving a fraction.
   */
  const handleExportCSV = async () => {
    setExporting(true);
    setExportNotice(null);
    try {
      const query = new URLSearchParams();
      if (auditSearchQuery) query.append('search', auditSearchQuery);
      if (auditActionFilter) query.append('actionType', auditActionFilter);
      const { from, to } = resolveDateRange(auditDateRange);
      if (from) query.append('from', from);
      if (to) query.append('to', to);
      if (actorFilter) query.append('actor', actorFilter);
      if (statusFilter) query.append('status', statusFilter);

      const result = await remoteDownloadCsv(
        `${API_BASE_URL}/api/audit-logs/export?${query.toString()}`,
        `lead-audit-logs-${new Date().toISOString().split('T')[0]}.csv`,
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

  /* The Action column's vocabulary. Was a toolbar <select>; the host puts this in the header. */
const ACTION_FILTER_OPTIONS = [
  { value: 'CREATE', label: 'Create Events' },
  { value: 'EDIT', label: 'Update Events' },
  { value: 'DELETE', label: 'Deletion Events' },
  { value: 'VIEW', label: 'View Audits' },
];

const STATUS_FILTER_OPTIONS = [
  { value: 'SUCCESS', label: 'Success' },
  { value: 'FAILED', label: 'Failed' },
];

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

  /* Maps each action verb to an icon — matches host's ACTION_ICONS so all tables use the same
     icon+text chip shape (Create=Plus, Update=Edit, Delete=Trash, View=Eye). */
  const getActionIcon = (action: string): typeof Icon.Edit => {
    switch (action.toLowerCase()) {
      case 'create': return Icon.Plus;
      case 'edit':
      case 'update': return Icon.Edit;
      case 'delete': return Icon.Trash;
      case 'view': return Icon.Eye;
      default: return Icon.Edit;
    }
  };

  // Shared, so this table matches the host and customer360 exactly.
  const formatTimestamp = formatAuditTimestamp;

  return (
    <div className={shell.page}>
      {/* Hero Banner — Host Pattern */}
      <PageHeader
        icon={<ShieldCheck size={24} />}
        title="Audit Trail Logs"
        pill={`${auditLogs.length} Events Logged`}
        subtitle="Immutable compliance record of all lead creation, update, view, and deletion events"
        actions={
          /*
           * This used to be a UI gate and nothing more, because the CSV was assembled here from rows
           * the caller already held under AuditLog:View — hiding the button withheld one click, not
           * the data.
           *
           * It is a real boundary now. The server assembles the file and enforces the same
           * capability at the endpoint, so a caller without it gets a 403 rather than a hidden
           * button and a working curl.
           */
          canExportAuditLogs() ? (
            <Button
              type="button"
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

      {/*
        A capped or refused export, reported rather than swallowed. The browser-built export it
        replaces logged its failures to the console and truncated its successes without a word, so
        neither outcome reached the person who asked for the file.
      */}
      {exportNotice && (
        <div className={styles.exportNotice} role="status">
          {exportNotice}
        </div>
      )}

      {/* Main Table Container Card */}
      <FilterBar
        filters={[
          auditActionFilter && {
            key: 'action',
            label: 'What Happened',
            value: ACTION_FILTER_OPTIONS.find((o) => o.value === auditActionFilter)?.label ?? auditActionFilter,
            onRemove: () => setAuditActionFilter(''),
          },
          actorFilter && { key: 'actor', label: 'Performed By', value: actorFilter, onRemove: () => setActorFilter('') },
          statusFilter && {
            key: 'status',
            label: 'Status',
            value: STATUS_FILTER_OPTIONS.find((o) => o.value === statusFilter)?.label ?? statusFilter,
            onRemove: () => setStatusFilter(''),
          },
          auditSearchQuery && {
            key: 'search',
            label: 'Search',
            value: `"${auditSearchQuery}"`,
            onRemove: () => setSearchInput(''),
          },
        ].filter(Boolean) as ActiveFilter[]}
        onClearAll={() => {
          setAuditActionFilter('');
          setActorFilter('');
          setStatusFilter('');
          setSearchInput('');
        }}
      />

      <div
        className={shell.card}
      >
        {/* Toolbar */}
        <div className={shell.toolbar}>
          {/* Action Filter & Search */}
          <div className={shell.toolbarLeftWide}>
            <div className={shell.searchGrow}>
              <SearchField
                placeholder="Search description, user, IP..."
                value={searchInput}
                onValueChange={setSearchInput}
                suggestions={searchSuggestions}
                onSelectSuggestion={(s) => setSearchInput(s.id)}
                emptyHint="No matches in the loaded page."
              />
            </div>
          </div>

          {/* Rows-per-page sits with the table's other controls, as the host's Audit Logs does —
              it was in the pagination footer, which meant scrolling past the whole table to change
              how much of it you see. */}
          <RowsPerPage storageKey="lead.audit" value={auditPageSize} onChange={setAuditPageSize} />

          {/* Labelled, not an icon alone: an unlabelled glyph beside a labelled Export button read
              as an afterthought and left the toolbar visually unbalanced. */}
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => fetchAuditLogs({ fresh: true })}
            disabled={isLoadingAuditLogs}
            leadingIcon={<RefreshCw size={15} className={isLoadingAuditLogs ? 'animate-spin' : ''} />}
          >
            Refresh
          </Button>
        </div>

        {/* Main Table — always rendered so columns stay visible on empty filter results */}
        <DataTable bare footer={<Pagination page={auditPage} pageSize={auditPageSize} total={totalAuditRecords} itemLabel="event" onPageChange={setAuditPage} />}>
          <ResponsiveRows
            rows={auditLogs}
            rowKey={(log) => String(log.id)}
            loading={isLoadingAuditLogs}
            loadingRows={auditPageSize}
            empty={
              auditSearchQuery || auditActionFilter || statusFilter || actorFilter
                ? 'No audit logs match the selected filters. Try adjusting or clearing them.'
                : 'No audit events have been recorded yet.'
            }
            columns={[
              {
                key: 'timestamp',
                label: 'Date & Time',
                priority: 'always',
                // The date filter this screen never had. The endpoint behind it has accepted date
                // parameters the whole time; nothing in the UI had ever sent them.
                header: (
                  <DateRangeColumnFilter
                    key="timestamp"
                    label="Date & Time"
                    value={auditDateRange}
                    onChange={setAuditDateRange}
                  />
                ),
                render: (log) => (
                  <span className={styles.timestampCell}>{formatTimestamp(log.timestamp)}</span>
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
                    searchable
                    filterType="alpha"
                    searchPlaceholder="Type a name to narrow…"
                    emptyHint="Nobody in this log matches that."
                  />
                ),
                render: (log) => (
                  <ActorCell name={log.userName || 'System'} meta={log.userRole || 'User'} />
                ),
              },
              {
                key: 'action',
                label: 'What Happened',
                priority: 'high',
                header: (
                  <ColumnFilter
                    key="action"
                    label="What Happened"
                    value={auditActionFilter}
                    onChange={setAuditActionFilter}
                    options={ACTION_FILTER_OPTIONS}
                    allLabel="All Action Types"
                  />
                ),
                render: (log) => {
                  const badge = getActionBadge(log.actionType);
                  const ActionIcon = getActionIcon(log.actionType);
                  return (
                    <span
                      className={styles.actionChip}
                      style={
                        {
                          '--audit-chip-bg': badge.bg,
                          '--audit-chip-text': badge.text,
                          '--audit-chip-border': badge.border,
                        } as React.CSSProperties
                      }
                    >
                      <ActionIcon width={11} height={11} />
                      {getActionLabel(log.actionType)}
                    </span>
                  );
                },
              },
              {
                key: 'description',
                clamp: true,
                label: 'Description',
                priority: 'low',
                render: (log) => (
                  <div className={styles.descriptionCell}>
                    <div>{log.description}</div>
                    {log.reason && (
                      <div className={styles.descriptionMeta}>Reason: {log.reason}</div>
                    )}
                  </div>
                ),
              },
              {
                key: 'status',
                label: 'Outcome & IP Address',
                priority: 'low',
                header: (
                  <ColumnFilter
                    key="status"
                    label="Outcome & IP Address"
                    title="Filter Outcome"
                    value={statusFilter}
                    onChange={setStatusFilter}
                    options={STATUS_FILTER_OPTIONS}
                    allLabel="All Statuses"
                  />
                ),
                render: (log) => (
                  <>
                    <Badge tone={log.status?.toUpperCase() === 'SUCCESS' ? 'success' : 'danger'} dot>
                      {log.status}
                    </Badge>
                    {log.ipAddress ? <div className={styles.ipMeta}>{log.ipAddress}</div> : null}
                  </>
                ),
              },
              {
                key: 'details',
                label: 'Details',
                priority: 'always',
                align: 'right',
                /* The verb is "View" platform-wide — this said "Inspect". */
                render: (log) => (
                  <RowAction
                    onClick={(e) => {
                      e.stopPropagation();
                      openAuditDetails(log);
                    }}
                  />
                ),
              },
            ]}
          />
        </DataTable>
      </div>

      <AuditDetailsDrawer />
    </div>
  );
};

export default AuditLogsPage;
