import { useEffect, useState } from "react";
import { CustomSelect } from "../components/common/CustomSelect";
import { Icon } from "../components/common/Icon";
import { EmptyState, ErrorState, LoadingSkeletonRows } from "../components/common/EmptyState";
import { useAuditLogStore } from "../stores/useAuditLogStore";
import { useDrawerStore } from "../stores/useDrawerStore";
import { subscribeToAuditLogs } from "../services/realtime";
import { CsvExportError, DateRangeFilterButton, EMPTY_DATE_RANGE, describeTruncation, formatAuditTimestamp, Pagination, Button, PageHeader } from "@omniconnect/ui";
import { downloadServerCsv } from "../services/exportCsv";
import { usePermissions } from "../permissions/PermissionContext";
import { PERMISSIONS } from "../permissions/permissions";
import { useToastStore } from "../stores/useToastStore";
import { useShallow } from "zustand/react/shallow";
import "./AuditLogsPage.css";

function formatAction(action: string): string {
  return action
    .replace(/[._]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function AuditLogsPage() {
  const {
    items,
    loading,
    error,
    search,
    action,
    entityType,
    dateRange,
    page,
    pageSize,
    totalCount,
    actionOptions,
    entityTypeOptions,
    summary,
    liveCount,
    setSearch,
    setAction,
    setEntityType,
    setDateRange,
    currentFilters,
    setPage,
    setPageSize,
    fetchAuditLogs,
    fetchActionOptions,
    fetchEntityTypes,
    ingestLiveEntry,
  } = useAuditLogStore(useShallow((s) => ({ items: s.items, loading: s.loading, error: s.error, search: s.search, action: s.action, entityType: s.entityType, dateRange: s.dateRange, page: s.page, pageSize: s.pageSize, totalCount: s.totalCount, actionOptions: s.actionOptions, entityTypeOptions: s.entityTypeOptions, summary: s.summary, liveCount: s.liveCount, setSearch: s.setSearch, setAction: s.setAction, setEntityType: s.setEntityType, setDateRange: s.setDateRange, currentFilters: s.currentFilters, setPage: s.setPage, setPageSize: s.setPageSize, fetchAuditLogs: s.fetchAuditLogs, fetchActionOptions: s.fetchActionOptions, fetchEntityTypes: s.fetchEntityTypes, ingestLiveEntry: s.ingestLiveEntry })));
  const { open } = useDrawerStore(useShallow((s) => ({ open: s.open })));
  const [live, setLive] = useState(false);
  const [exporting, setExporting] = useState(false);
  const canExport = usePermissions().has(PERMISSIONS.AUDIT_LOGS_EXPORT);
  const [pageSizeOption, setPageSizeOption] = useState<string>("10");
  const [customPageSize, setCustomPageSize] = useState<number>(15);

  useEffect(() => {
    fetchActionOptions();
    fetchEntityTypes();
  }, [fetchActionOptions, fetchEntityTypes]);

  useEffect(() => {
    fetchAuditLogs();
  }, [search, action, entityType, dateRange, page, pageSize, fetchAuditLogs]);

  useEffect(() => {
    const unsubscribe = subscribeToAuditLogs(
      (entry) => ingestLiveEntry(entry),
      (connected) => setLive(connected)
    );
    return unsubscribe;
  }, [ingestLiveEntry]);

  const hasFilters = !!(search || action || entityType || dateRange.preset !== "all" || pageSizeOption !== "10");

  function handlePageSizeChange(opt: string) {
    setPageSizeOption(opt);
    if (opt === "all") {
      setPageSize(100);
    } else if (opt === "custom") {
      setPageSize(customPageSize || 10);
    } else {
      setPageSize(parseInt(opt, 10) || 10);
    }
  }

  /** Downloads every matching entry, built by the server with the filters on screen. */
  async function handleExport() {
    setExporting(true);
    try {
      const result = await downloadServerCsv("/audit-logs/export", { ...currentFilters() }, `products-audit-log-${new Date().toISOString().slice(0, 10)}.csv`);
      const truncation = describeTruncation(result);
      if (truncation) useToastStore.getState().warning("Download limited", truncation);
    } catch (err) {
      useToastStore.getState().danger("Download failed", err instanceof CsvExportError ? err.message : "The audit log could not be downloaded.");
    } finally {
      setExporting(false);
    }
  }

  // Figures come from the server's aggregate over the full filtered set - counting the rows in
  // `items` would only ever describe the page currently on screen.
  const totalEvents = summary?.totalCount ?? totalCount;
  const successCount = summary?.successCount ?? 0;

  return (
    <div className="pm-page pm-audit-logs-page">
      <PageHeader
        title="Security & Audit Logs"
        subtitle="Compliance trail of admin actions and platform lifecycle events."
        icon={<Icon name="shield" size={24} />}
        pill={live ? "Live" : "Connecting…"}
        actions={
          <>
            <DateRangeFilterButton label="Date Range" value={dateRange} onChange={setDateRange} />
            {canExport && (
              <Button variant="onHeader" leadingIcon={<Icon name="download" size={15} />} onClick={() => void handleExport()} disabled={exporting}>
                {exporting ? "Downloading…" : "Download CSV"}
              </Button>
            )}
          </>
        }
      />

      <div className="pm-kpi-grid">
        <div className="pm-kpi-card pm-kpi-tone-blue">
          <div className="pm-kpi-top">
            <div className="pm-kpi-icon pm-kpi-icon-blue">
              <Icon name="shield" size={20} />
            </div>
            <span className="pm-kpi-label">Total Events</span>
          </div>
          <div className="pm-kpi-value-row">
            <span className="pm-kpi-value">{totalEvents}</span>
          </div>
          <div className="pm-kpi-trend-row">
            <span className="pm-badge pm-badge-info">Platform-wise</span>
            <span className="pm-kpi-subtitle">Audit Ledger</span>
          </div>
        </div>

        <div className="pm-kpi-card pm-kpi-tone-green">
          <div className="pm-kpi-top">
            <div className="pm-kpi-icon pm-kpi-icon-green">
              <Icon name="check" size={20} />
            </div>
            <span className="pm-kpi-label">Success Rate</span>
          </div>
          <div className="pm-kpi-value-row">
            <span className="pm-kpi-value">{successCount} / {totalEvents}</span>
          </div>
          <div className="pm-kpi-trend-row">
            <span className="pm-badge pm-badge-success">Operational</span>
            <span className="pm-kpi-subtitle">Verified Success</span>
          </div>
        </div>

        <div className="pm-kpi-card pm-kpi-tone-purple">
          <div className="pm-kpi-top">
            <div className="pm-kpi-icon pm-kpi-icon-purple">
              <Icon name="list" size={20} />
            </div>
            <span className="pm-kpi-label">Action Types</span>
          </div>
          <div className="pm-kpi-value-row">
            <span className="pm-kpi-value">{summary?.actionTypeCount ?? actionOptions.length}</span>
          </div>
          <div className="pm-kpi-trend-row">
            <span className="pm-badge pm-badge-neutral">Tracked</span>
            <span className="pm-kpi-subtitle">Granular Operations</span>
          </div>
        </div>

        <div className="pm-kpi-card pm-kpi-tone-amber">
          <div className="pm-kpi-top">
            <div className="pm-kpi-icon pm-kpi-icon-amber">
              <Icon name="clock" size={20} />
            </div>
            <span className="pm-kpi-label">Stream Status</span>
          </div>
          <div className="pm-kpi-value-row">
            <span className="pm-kpi-value" style={{ fontSize: 18, marginTop: 4 }}>{live ? "Connected" : "Standby"}</span>
          </div>
          <div className="pm-kpi-trend-row">
            <span className="pm-badge pm-badge-warning">SignalR</span>
            <span className="pm-kpi-subtitle">Zero-latency Feed</span>
          </div>
        </div>
      </div>

      <div className="pm-filter-bar pm-categories-filter-bar">
        <div className="pm-search-input">
          <Icon name="search" size={16} />
          <input
            placeholder="Search by initiator, entity, or description..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="pm-hero-clear-btn" onClick={() => setSearch("")} title="Clear search">
              <Icon name="close" size={14} />
            </button>
          )}
        </div>

        <div className="pm-filter-combo">
          <CustomSelect aria-label="Action" options={[{ value: "", label: "All Actions" }, ...actionOptions]} value={action ?? ""} onChange={(v) => setAction(v || null)} />
        </div>

        <div className="pm-filter-combo">
          <CustomSelect aria-label="Record type" options={[{ value: "", label: "All Entities" }, ...entityTypeOptions]} value={entityType ?? ""} onChange={(v) => setEntityType(v || null)} />
        </div>

        <div className="pm-page-size-picker">
          <span className="pm-filter-label">Show:</span>
          <select
            className="pm-select pm-select-sm"
            value={pageSizeOption}
            onChange={(e) => handlePageSizeChange(e.target.value)}
          >
            <option value="5">5</option>
            <option value="10">10</option>
            <option value="25">25</option>
            <option value="all">All</option>
            <option value="custom">Custom</option>
          </select>
          {pageSizeOption === "custom" && (
            <input
              type="number"
              min={1}
              max={100}
              className="pm-input pm-custom-page-size-input"
              value={customPageSize}
              onChange={(e) => {
                const val = Math.max(1, parseInt(e.target.value, 10) || 1);
                setCustomPageSize(val);
                setPageSize(val);
              }}
              title="Custom quantity"
              placeholder="Qty"
            />
          )}
        </div>

        {hasFilters && (
          <button
            className="pm-btn pm-btn-outline"
            onClick={() => {
              setSearch("");
              setAction(null);
              setEntityType(null);
              setDateRange(EMPTY_DATE_RANGE);
              handlePageSizeChange("10");
            }}
          >
            <Icon name="filter-x" size={14} /> Reset Filters
          </button>
        )}
      </div>

      {liveCount > 0 && (
        <button className="pm-live-banner" onClick={() => { setPage(1); fetchAuditLogs(); }}>
          <Icon name="arrow-up" size={14} /> {liveCount} new event{liveCount === 1 ? "" : "s"} received - click to refresh
        </button>
      )}

      <div className="pm-card pm-categories-table-card">
        {loading ? (
          <LoadingSkeletonRows />
        ) : error ? (
          <ErrorState message={error} onRetry={fetchAuditLogs} />
        ) : items.length === 0 ? (
          <EmptyState icon="info" title="No audit events found" description="Admin actions, application decisions and customer activity will appear here as they happen." />
        ) : (
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Initiated By</th>
                  <th>Action</th>
                  <th>Entity</th>
                  <th>Description</th>
                  <th>Status</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {items.map((log) => (
                  <tr key={log.id} style={{ cursor: "pointer" }} onClick={() => open("audit-log-details", { auditLogId: log.id })}>
                    <td className="pm-text-muted" style={{ whiteSpace: "nowrap" }}>
                      {formatAuditTimestamp(log.timestamp)}
                    </td>
                    <td>
                      <div className="pm-cat-name-cell">
                        <div className="pm-cat-icon-squircle">
                          <Icon name="user" size={15} />
                        </div>
                        <strong>{log.actorName}</strong>
                      </div>
                    </td>
                    <td>
                      <span className="pm-badge pm-badge-info">{formatAction(log.action)}</span>
                    </td>
                    <td>
                      <strong>{log.entityType}</strong>
                      {log.entityName && <span className="pm-text-muted"> · {log.entityName}</span>}
                    </td>
                    <td className="pm-text-muted" style={{ maxWidth: 320 }}>
                      {log.description}
                    </td>
                    <td>
                      <span className={`pm-badge ${log.success ? "pm-badge-success" : "pm-badge-danger"}`}>
                        {log.success ? "Success" : "Failed"}
                      </span>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        className="pm-icon-btn pm-icon-btn-view"
                        onClick={() => open("audit-log-details", { auditLogId: log.id })}
                        title="View Audit Event Details"
                      >
                        <Icon name="eye" size={14} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Pagination page={page} total={totalCount} pageSize={pageSize} onPageChange={setPage} itemLabel="event" />
    </div>
  );
}

