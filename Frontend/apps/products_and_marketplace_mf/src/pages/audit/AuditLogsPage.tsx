import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  Badge,
  Button,
  CsvExportError,
  DataTable,
  DateRangeFilterButton,
  EMPTY_DATE_RANGE,
  FilterBar,
  Icon,
  PageHeader,
  Pagination,
  ResponsiveRows,
  RowAction,
  RowsPerPage,
  Select,
  StatTile,
  StatTileSkeleton,
  describeDateRange,
  describeTruncation,
  formatAuditTimestamp,
  type ActiveFilter,
  type ResponsiveColumn,
} from '@omniconnect/ui';
import { ListToolbar } from '../../components/ListToolbar';
import { usePermissions } from '../../permissions/PermissionContext';
import { PERMISSIONS } from '../../permissions/permissions';
import { downloadServerCsv } from '../../services/exportCsv';
import { subscribeToAuditLogs } from '../../services/realtime';
import { useAuditLogStore } from '../../stores/useAuditLogStore';
import { useToastStore } from '../../stores/useToastStore';
import { formatAuditAction } from '../../utils/format';
import type { AuditLog } from '../../types/domain';
import { AuditLogDetailsDrawer } from './AuditLogDetailsDrawer';
import styles from '../page.module.css';

const PAGE_SIZE_KEY = 'products.audit';

/** The trail of who did what in Products & Marketplace, with a live feed of new events. */
export function AuditLogsPage() {
  const s = useAuditLogStore(
    useShallow((state) => ({
      items: state.items, loading: state.loading, error: state.error, search: state.search, action: state.action, entityType: state.entityType,
      dateRange: state.dateRange, page: state.page, pageSize: state.pageSize, totalCount: state.totalCount, actionOptions: state.actionOptions,
      entityTypeOptions: state.entityTypeOptions, summary: state.summary, liveCount: state.liveCount,
    })),
  );
  const a = useAuditLogStore(
    useShallow((state) => ({
      setSearch: state.setSearch, setAction: state.setAction, setEntityType: state.setEntityType, setDateRange: state.setDateRange,
      currentFilters: state.currentFilters, setPage: state.setPage, setPageSize: state.setPageSize, fetchAuditLogs: state.fetchAuditLogs,
      fetchActionOptions: state.fetchActionOptions, fetchEntityTypes: state.fetchEntityTypes, ingestLiveEntry: state.ingestLiveEntry,
    })),
  );
  const { fetchActionOptions, fetchEntityTypes, fetchAuditLogs, ingestLiveEntry } = a;
  const canExport = usePermissions().has(PERMISSIONS.AUDIT_LOGS_EXPORT);
  const [live, setLive] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  useEffect(() => {
    void fetchActionOptions();
    void fetchEntityTypes();
  }, [fetchActionOptions, fetchEntityTypes]);

  useEffect(() => {
    void fetchAuditLogs();
  }, [s.search, s.action, s.entityType, s.dateRange, s.page, s.pageSize, fetchAuditLogs]);

  useEffect(() => subscribeToAuditLogs((entry) => ingestLiveEntry(entry), setLive), [ingestLiveEntry]);

  const actionOptions = useMemo(() => s.actionOptions.map((o) => ({ value: o.value, label: o.label })), [s.actionOptions]);
  const entityOptions = useMemo(() => s.entityTypeOptions.map((e) => ({ value: e, label: e })), [s.entityTypeOptions]);
  const filtered = Boolean(s.search || s.action || s.entityType || s.dateRange.preset !== 'all');

  const reset = () => {
    a.setSearch('');
    a.setAction(null);
    a.setEntityType(null);
    a.setDateRange(EMPTY_DATE_RANGE);
  };

  /**
   * Refresh, and jump to the newest page.
   *
   * `fresh` is not optional here: every read in this app goes through a cache that reuses a success
   * for 30s, so a Refresh re-sending the identical URL would make no request at all. Going back to
   * page 1 is what makes it do what a person pressing it wants — show me what has just happened.
   */
  const refetch = () => {
    a.setPage(1);
    void fetchAuditLogs({ fresh: true });
  };

  /** Downloads every matching entry, built by the server with the filters on screen. */
  const download = async () => {
    setExporting(true);
    try {
      const result = await downloadServerCsv('/audit-logs/export', { ...a.currentFilters() }, `products-audit-log-${new Date().toISOString().slice(0, 10)}.csv`);
      const truncation = describeTruncation(result);
      if (truncation) useToastStore.getState().warning('Download limited', truncation);
    } catch (err) {
      useToastStore.getState().danger('Download failed', err instanceof CsvExportError ? err.message : 'The audit log could not be downloaded.');
    } finally {
      setExporting(false);
    }
  };

  // The figures come from the server's aggregate over the whole filtered set; counting `items` would
  // only ever describe the page on screen.
  const total = s.summary?.totalCount ?? s.totalCount;

  const activeFilters: ActiveFilter[] = [
    s.search && { key: 'search', label: 'Search', value: s.search, onRemove: () => a.setSearch('') },
    s.action && {
      key: 'action',
      label: 'Action',
      value: actionOptions.find((o) => o.value === s.action)?.label ?? formatAuditAction(s.action),
      onRemove: () => a.setAction(null),
    },
    s.entityType && { key: 'entityType', label: 'Record type', value: s.entityType, onRemove: () => a.setEntityType(null) },
    s.dateRange.preset !== 'all' && {
      key: 'dateRange',
      label: 'Date',
      value: describeDateRange(s.dateRange),
      onRemove: () => a.setDateRange(EMPTY_DATE_RANGE),
    },
  ].filter(Boolean) as ActiveFilter[];

  const columns: ResponsiveColumn<AuditLog>[] = [
    {
      key: 'timestamp',
      label: 'Time',
      priority: 'always',
      render: (log) => <span className={`${styles.muted} ${styles.nowrap}`}>{formatAuditTimestamp(log.timestamp)}</span>,
    },
    { key: 'actor', label: 'Performed by', priority: 'high', render: (log) => <span className={styles.name}>{log.actorName}</span> },
    { key: 'action', label: 'Action', priority: 'high', render: (log) => <Badge tone="info">{formatAuditAction(log.action)}</Badge> },
    {
      key: 'record',
      label: 'Record',
      priority: 'low',
      render: (log) => (
        <div className={styles.nameText}>
          <span className={styles.name}>{log.entityType}</span>
          {log.entityName && <span className={styles.sub}>{log.entityName}</span>}
        </div>
      ),
    },
    { key: 'description', label: 'Description', priority: 'low', clamp: true, render: (log) => log.description },
    {
      key: 'result',
      label: 'Result',
      priority: 'high',
      render: (log) => <Badge tone={log.success ? 'success' : 'danger'}>{log.success ? 'Success' : 'Failed'}</Badge>,
    },
    {
      key: 'details',
      label: <span className={styles.srOnly}>Details</span>,
      priority: 'always',
      align: 'right',
      render: (log) => (
        <RowAction
          onClick={() => setSelectedId(log.id)}
          aria-label={`View details of ${formatAuditAction(log.action)} by ${log.actorName}`}
        >
          View
        </RowAction>
      ),
    },
  ];

  return (
    <div className={styles.page}>
      <PageHeader
        icon={<Icon.ShieldCheck />}
        title="Audit Logs"
        subtitle="Who changed what in Products & Marketplace, and when."
        pill={live ? 'Live' : 'Connecting…'}
        actions={
          <>
            <DateRangeFilterButton label="Date range" value={s.dateRange} onChange={a.setDateRange} />
            {canExport && (
              <Button variant="onHeader" leadingIcon={<Icon.Download />} onClick={() => void download()} disabled={exporting}>
                {exporting ? 'Downloading…' : 'Download CSV'}
              </Button>
            )}
          </>
        }
      />

      {s.summary || !s.loading ? (
        <div className={styles.kpis}>
          <StatTile label="Total events" value={total} accent="primary" icon={<Icon.ShieldCheck />} />
          <StatTile label="Successful" value={s.summary?.successCount ?? 0} accent="success" icon={<Icon.CheckCircle />} />
          <StatTile label="Action types" value={s.summary?.actionTypeCount ?? s.actionOptions.length} accent="info" icon={<Icon.Activity />} />
        </div>
      ) : (
        <div className={styles.kpis} aria-hidden="true">
          <StatTileSkeleton />
          <StatTileSkeleton />
          <StatTileSkeleton />
        </div>
      )}

      <FilterBar filters={activeFilters} onClearAll={reset} />

      {s.error && (
        <div role="alert" className={styles.error}>
          <span>{s.error}</span>
          <Button variant="secondary" size="sm" onClick={refetch}>Try again</Button>
        </div>
      )}

      <div className={styles.card} aria-busy={s.loading}>
        <div className={styles.toolbar}>
          <ListToolbar
            searchLabel="Search the audit log"
            searchPlaceholder="Search by person, record or description…"
            search={s.search}
            onSearchChange={a.setSearch}
            canReset={filtered}
            onReset={reset}
            trailing={
              <>
                <RowsPerPage storageKey={PAGE_SIZE_KEY} value={s.pageSize} onChange={a.setPageSize} />
                <Button
                  variant="secondary"
                  size="sm"
                  leadingIcon={<Icon.Activity width={15} height={15} />}
                  disabled={s.loading}
                  onClick={refetch}
                >
                  Refresh
                </Button>
              </>
            }
          >
            <div className={styles.filterControl}>
              <Select aria-label="Filter by action" options={actionOptions} value={s.action ?? ''} placeholder="All actions" clearLabel="All actions" onChange={(e) => a.setAction(e.target.value || null)} />
            </div>
            <div className={styles.filterControl}>
              <Select aria-label="Filter by record type" options={entityOptions} value={s.entityType ?? ''} placeholder="All record types" clearLabel="All record types" onChange={(e) => a.setEntityType(e.target.value || null)} />
            </div>
          </ListToolbar>
        </div>

        {/* Inside the card now, with the toolbar it belongs beside. Refresh complements this rather
            than replacing it: the banner only appears when events arrived that the current page and
            filters would not have shown. */}
        {s.liveCount > 0 && (
          <div className={styles.liveRow}>
            <button type="button" className={styles.liveBanner} onClick={refetch}>
              <Icon.ChevronUp /> {s.liveCount} new event{s.liveCount === 1 ? '' : 's'} — show them
            </button>
          </div>
        )}

        <DataTable
          bare
          reserveHeight
          footer={<Pagination page={s.page} pageSize={s.pageSize} total={s.totalCount} itemLabel="event" onPageChange={a.setPage} />}
        >
          <ResponsiveRows
            columns={columns}
            rows={s.items}
            rowKey={(log) => log.id}
            loading={s.loading && s.items.length === 0}
            loadingRows={Math.min(s.pageSize, 8)}
            empty={
              filtered
                ? 'No events match. Try widening the search or the date range.'
                : 'No events yet. Changes made in Products & Marketplace will appear here as they happen.'
            }
          />
        </DataTable>
      </div>

      <AuditLogDetailsDrawer auditLogId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
