import { useEffect, useState } from "react";
import { Icon } from "../components/common/Icon";
import { Pagination } from "../components/common/Pagination";
import { EmptyState, ErrorState, LoadingSkeletonRows } from "../components/common/EmptyState";
import { useAuditLogStore } from "../stores/useAuditLogStore";
import { useDrawerStore } from "../stores/useDrawerStore";
import { subscribeToAuditLogs } from "../services/realtime";
import { exportToCsv } from "../utils/exportCsv";
import { formatDate } from "../utils/fieldFormat";
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
    page,
    pageSize,
    totalCount,
    totalPages,
    actionOptions,
    entityTypeOptions,
    summary,
    liveCount,
    setSearch,
    setAction,
    setEntityType,
    setPage,
    setPageSize,
    fetchAuditLogs,
    fetchActionOptions,
    fetchEntityTypes,
    ingestLiveEntry,
  } = useAuditLogStore();
  const { open } = useDrawerStore();
  const [live, setLive] = useState(false);
  const [pageSizeOption, setPageSizeOption] = useState<string>("10");
  const [customPageSize, setCustomPageSize] = useState<number>(15);

  const todayFormatted = new Date().toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  useEffect(() => {
    fetchActionOptions();
    fetchEntityTypes();
  }, [fetchActionOptions, fetchEntityTypes]);

  useEffect(() => {
    fetchAuditLogs();
  }, [search, action, entityType, page, pageSize, fetchAuditLogs]);

  useEffect(() => {
    const unsubscribe = subscribeToAuditLogs(
      (entry) => ingestLiveEntry(entry),
      (connected) => setLive(connected)
    );
    return unsubscribe;
  }, [ingestLiveEntry]);

  const hasFilters = !!(search || action || entityType || pageSizeOption !== "10");

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

  function handleExport() {
    exportToCsv(
      "audit-logs.csv",
      items.map((l) => ({
        Timestamp: l.timestamp,
        "Initiated By": l.actorName,
        Action: l.action,
        EntityType: l.entityType,
        EntityName: l.entityName || "-",
        Description: l.description,
        Success: l.success ? "Yes" : "No",
      }))
    );
  }

  // Figures come from the server's aggregate over the full filtered set - counting the rows in
  // `items` would only ever describe the page currently on screen.
  const totalEvents = summary?.totalCount ?? totalCount;
  const successCount = summary?.successCount ?? 0;

  return (
    <div className="pm-page pm-audit-logs-page">
      <div className="pm-hero-banner">
        <div className="pm-hero-banner-content">
          <div className="pm-hero-icon-wrap">
            <Icon name="shield" size={26} />
          </div>
          <div className="pm-hero-text">
            <div className="pm-hero-badge-row">
              <span className={`pm-hero-live-badge ${live ? "connected" : ""}`}>
                • {live ? "Live Security Trail" : "Connecting Trail..."}
              </span>
              <span className="pm-hero-date">{todayFormatted}</span>
            </div>
            <h1>Security & Audit Logs</h1>
            <p>Real-time, immutable compliance trail of admin actions and platform lifecycle events.</p>
          </div>
        </div>
        <div className="pm-hero-actions">
          <button className="pm-btn pm-hero-add-btn" onClick={handleExport}>
            <Icon name="download" size={15} /> Export Log CSV
          </button>
        </div>
      </div>

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

        <select className="pm-select" value={action ?? ""} onChange={(e) => setAction(e.target.value || null)}>
          <option value="">All Actions</option>
          {actionOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select className="pm-select" value={entityType ?? ""} onChange={(e) => setEntityType(e.target.value || null)}>
          <option value="">All Entities</option>
          {entityTypeOptions.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>

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
                      {formatDate(log.timestamp, { day: "2-digit", month: "short", year: "numeric" })}{" "}
                      {new Date(log.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
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

      <Pagination page={page} totalPages={totalPages} totalCount={totalCount} pageSize={pageSize} onPageChange={setPage} itemLabel="events" />
    </div>
  );
}

