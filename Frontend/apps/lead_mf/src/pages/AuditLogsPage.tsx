import { canExportAuditLogs } from '../api/hostBridge';
import React, { useEffect, useState } from 'react';
import { ShieldCheck, Search, RefreshCw, Eye, Download, X, ChevronLeft, ChevronRight } from '@omniremit/ui/icons';
import { ActorCell, Badge, Button, ColumnFilter, DataTable, FilterBar, Icon, PageHeader, Pagination, ResponsiveRows, RowAction, RowsPerPage, SearchField, formatAuditTimestamp, type ActiveFilter } from '@omniremit/ui';
import { useLeadStore } from '../store/useLeadStore';
import styles from './AuditLogsPage.module.css';
import shell from '../shared/leadPage.module.css';
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
    setAuditPageSize,
  } = useLeadStore();

  const totalAuditPages = Math.max(1, Math.ceil(totalAuditRecords / auditPageSize));
  const auditStartIndex = totalAuditRecords > 0 ? (auditPage - 1) * auditPageSize + 1 : 0;
  const auditEndIndex = Math.min(auditPage * auditPageSize, totalAuditRecords);

  // Client-side: the audit endpoint takes `action` and `search` only, so these narrow the page
  // that has already been fetched. Kept local rather than in the store for that reason.
  const [actorFilter, setActorFilter] = useState('');

  /*
   * The Actor column offers the people who ACTUALLY appear in the audit log, not a free-text box
   * and not the full role list. Typing narrows the list; clicking picks one. An empty
   * type-to-search box gave no clue who was even in the data — you had to already know a name to
   * find a row.
   *
   * Derived from the loaded page, which is the same scope the filter applies to, so the list can
   * never offer a name that would return nothing.
   */
  const actorOptions = React.useMemo(() => {
    const seen = new Map<string, string>();
    for (const log of auditLogs) {
      const name = (log.userName || 'System').trim();
      if (name && !seen.has(name.toLowerCase())) seen.set(name.toLowerCase(), name);
    }
    return [...seen.values()].sort((a, b) => a.localeCompare(b)).map((n) => ({ value: n, label: n }));
  }, [auditLogs]);
  const [statusFilter, setStatusFilter] = useState('');

  /*
   * Actor and Status filter CLIENT-SIDE — the audit endpoint accepts `action` and `search` only —
   * while paging is server-side. The two cannot both be authoritative: with an actor filter on,
   * page 2 of 2 read "Showing 11 to 13 of 13 events" above an empty table, because those three
   * rows were fetched but none matched.
   *
   * So while a client-side filter is active the pager describes the rows actually on screen and
   * server paging is suppressed. It is honest about what it is showing, at the cost of not
   * reaching matches on other pages — which needs `actor` and `status` query parameters on the
   * audit endpoint to fix properly.
   */
  const visibleLogs = auditLogs.filter((log) => {
    if (actorFilter && !`${log.userName ?? ''} ${log.userRole ?? ''}`.toLowerCase().includes(actorFilter.toLowerCase())) return false;
    if (statusFilter) {
      const ok = (log.status ?? '').toUpperCase() !== 'FAILED';
      if ((ok ? 'SUCCESS' : 'FAILED') !== statusFilter) return false;
    }
    return true;
  });
  const clientFiltered = Boolean(actorFilter || statusFilter);


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
           * The one capability on this page that is a UI gate and nothing more.
           *
           * The CSV is assembled here from rows already fetched under AuditLog:View, so hiding this
           * button withholds the convenience of one click, not the data — anyone who can read the
           * page can copy what is on it. It is still worth granting separately, because an export is
           * a distinct act that leaves the platform, but it must not be relied on as a control over
           * who can obtain the rows. The manifest says the same thing next to the declaration.
           */
          canExportAuditLogs() ? (
            <Button
              type="button"
              variant="onHeader"
              onClick={handleExportCSV}
              disabled={auditLogs.length === 0}
              leadingIcon={<Download size={15} />}
            >
              Export CSV
            </Button>
          ) : null
        }
      />

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
            onRemove: () => setAuditSearchQuery(''),
          },
        ].filter(Boolean) as ActiveFilter[]}
        onClearAll={() => {
          setAuditActionFilter('');
          setActorFilter('');
          setStatusFilter('');
          setAuditSearchQuery('');
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
                value={auditSearchQuery}
                onValueChange={setAuditSearchQuery}
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
            onClick={() => fetchAuditLogs()}
            leadingIcon={<RefreshCw size={15} className={isLoadingAuditLogs ? 'animate-spin' : ''} />}
          >
            Refresh
          </Button>
        </div>

        {/* Main Table — always rendered so columns stay visible on empty filter results */}
        <DataTable bare footer={<Pagination page={clientFiltered ? 1 : auditPage} pageSize={clientFiltered ? Math.max(visibleLogs.length, 1) : auditPageSize} total={clientFiltered ? visibleLogs.length : totalAuditRecords} itemLabel="event" onPageChange={setAuditPage} />}>
          <ResponsiveRows
            rows={visibleLogs}
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
                    searchable={actorOptions.length > 6}
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
