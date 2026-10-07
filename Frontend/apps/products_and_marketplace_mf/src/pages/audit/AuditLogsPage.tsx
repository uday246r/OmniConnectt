import { useEffect, useMemo, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  Badge, Button, CsvExportError, DataTable, DataTableEmpty, DateRangeFilterButton, EMPTY_DATE_RANGE, EmptyState, Icon, PageHeader, Pagination,
  RowAction, Select, TableSkeleton, describeTruncation, formatAuditTimestamp,
} from '@omniconnect/ui';
import { KpiTile } from '../../components/KpiTile';
import { ListToolbar } from '../../components/ListToolbar';
import { usePermissions } from '../../permissions/PermissionContext';
import { PERMISSIONS } from '../../permissions/permissions';
import { downloadServerCsv } from '../../services/exportCsv';
import { subscribeToAuditLogs } from '../../services/realtime';
import { useAuditLogStore } from '../../stores/useAuditLogStore';
import { useToastStore } from '../../stores/useToastStore';
import { formatAuditAction } from '../../utils/format';
import { AuditLogDetailsDrawer } from './AuditLogDetailsDrawer';
import styles from '../page.module.css';

const COLUMNS = 7;

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

      <div className={styles.kpis}>
        <KpiTile label="Total events" value={total} accent="primary" icon={<Icon.ShieldCheck />} caption="Everything recorded" />
        <KpiTile label="Successful" value={s.summary?.successCount ?? 0} accent="success" icon={<Icon.CheckCircle />} caption={`of ${total}`} />
        <KpiTile label="Action types" value={s.summary?.actionTypeCount ?? s.actionOptions.length} accent="info" icon={<Icon.Activity />} caption="Kinds of change tracked" />
      </div>

      <ListToolbar
        searchLabel="Search the audit log"
        searchPlaceholder="Search by person, record or description…"
        search={s.search}
        onSearchChange={a.setSearch}
        canReset={filtered}
        onReset={reset}
      >
        <div className={styles.control}>
          <Select aria-label="Filter by action" options={actionOptions} value={s.action ?? ''} placeholder="All actions" clearLabel="All actions" onChange={(e) => a.setAction(e.target.value || null)} />
        </div>
        <div className={styles.control}>
          <Select aria-label="Filter by record type" options={entityOptions} value={s.entityType ?? ''} placeholder="All record types" clearLabel="All record types" onChange={(e) => a.setEntityType(e.target.value || null)} />
        </div>
      </ListToolbar>

      {s.liveCount > 0 && (
        <button type="button" className={styles.liveBanner} onClick={() => { a.setPage(1); void a.fetchAuditLogs({ fresh: true }); }}>
          <Icon.ChevronUp /> {s.liveCount} new event{s.liveCount === 1 ? '' : 's'} — show them
        </button>
      )}

      {s.error && (
        <div role="alert" className={styles.error}>
          <span>{s.error}</span>
          <Button variant="secondary" size="sm" onClick={() => void a.fetchAuditLogs({ fresh: true })}>Try again</Button>
        </div>
      )}

      <div className={styles.card} aria-busy={s.loading}>
        <DataTable minWidth={900}>
          <thead>
            <tr>
              <th scope="col">Time</th>
              <th scope="col">Performed by</th>
              <th scope="col">Action</th>
              <th scope="col">Record</th>
              <th scope="col">Description</th>
              <th scope="col">Result</th>
              <th scope="col"><span className={styles.srOnly}>Details</span></th>
            </tr>
          </thead>
          <tbody>
            {s.loading && s.items.length === 0 ? (
              <TableSkeleton rows={Math.min(s.pageSize, 8)} columns={COLUMNS} />
            ) : s.items.length === 0 ? (
              <DataTableEmpty colSpan={COLUMNS}>
                <EmptyState compact icon={<Icon.ShieldCheck />} title={filtered ? 'No events match' : 'No events yet'} description={filtered ? 'Try widening the search or the date range.' : 'Changes made in Products & Marketplace will appear here as they happen.'} />
              </DataTableEmpty>
            ) : (
              s.items.map((log) => (
                <tr key={log.id}>
                  <td className={styles.muted} style={{ whiteSpace: 'nowrap' }}>{formatAuditTimestamp(log.timestamp)}</td>
                  <td className={styles.name}>{log.actorName}</td>
                  <td><Badge tone="info">{formatAuditAction(log.action)}</Badge></td>
                  <td>
                    <div className={styles.nameText}>
                      <span className={styles.name}>{log.entityType}</span>
                      {log.entityName && <span className={styles.sub}>{log.entityName}</span>}
                    </div>
                  </td>
                  <td className={styles.description}>{log.description}</td>
                  <td><Badge tone={log.success ? 'success' : 'danger'}>{log.success ? 'Success' : 'Failed'}</Badge></td>
                  <td className={styles.actions}><RowAction onClick={() => setSelectedId(log.id)} aria-label={`View details of ${formatAuditAction(log.action)} by ${log.actorName}`}>View</RowAction></td>
                </tr>
              ))
            )}
          </tbody>
        </DataTable>
        <div className={styles.footer}>
          <Pagination page={s.page} pageSize={s.pageSize} total={s.totalCount} itemLabel="events" onPageChange={a.setPage} onPageSizeChange={a.setPageSize} />
        </div>
      </div>

      <AuditLogDetailsDrawer auditLogId={selectedId} onClose={() => setSelectedId(null)} />
    </div>
  );
}
