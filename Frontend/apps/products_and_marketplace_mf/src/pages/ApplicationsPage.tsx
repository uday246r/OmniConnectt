import { useEffect, useState } from "react";
import { Icon } from "../components/common/Icon";
import { StatusBadge } from "../components/common/StatusBadge";
import { Pagination } from "../components/common/Pagination";
import { EmptyState, ErrorState, LoadingSkeletonRows } from "../components/common/EmptyState";
import { useApplicationStore } from "../stores/useApplicationStore";
import { useDrawerStore } from "../stores/useDrawerStore";
import { useStatusConfigStore } from "../stores/useStatusConfigStore";
import { formatDate } from "../utils/fieldFormat";

export function ApplicationsPage() {
  const {
    items,
    loading,
    error,
    search,
    status,
    page,
    pageSize,
    totalCount,
    totalPages,
    setSearch,
    setStatus,
    setPage,
    setPageSize,
    fetchApplications,
  } = useApplicationStore();
  const { open } = useDrawerStore();
  const { configs: statusConfigs, fetchAll: fetchStatusConfigs } = useStatusConfigStore();

  const [pageSizeOption, setPageSizeOption] = useState<string>("10");
  const [customPageSize, setCustomPageSize] = useState<number>(15);

  const applicationStatuses = statusConfigs
    .filter((c) => c.entityType === "Application" && c.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  const todayFormatted = new Date().toLocaleDateString("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  });

  useEffect(() => {
    fetchStatusConfigs();
  }, [fetchStatusConfigs]);

  useEffect(() => {
    fetchApplications();
  }, [search, status, page, pageSize, fetchApplications]);

  const pendingCount = items.filter((a) => a.status === "Submitted" || a.status === "UnderReview").length;
  const approvedCount = items.filter((a) => a.status === "Approved" || a.status === "Completed").length;
  const docsNeededCount = items.filter((a) => a.status === "DocumentsRequired").length;

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

  return (
    <div className="pm-page pm-applications-page">
      <div className="pm-hero-banner">
        <div className="pm-hero-banner-content">
          <div className="pm-hero-icon-wrap">
            <Icon name="file" size={26} />
          </div>
          <div className="pm-hero-text">
            <div className="pm-hero-badge-row">
              <span className="pm-hero-live-badge">• Processing Pipeline</span>
              <span className="pm-hero-date">{todayFormatted}</span>
            </div>
            <h1>Application Pipeline</h1>
            <p>Review, evaluate, verify documents, and process customer product applications.</p>
          </div>
        </div>
      </div>

      <div className="pm-kpi-grid">
        <div className="pm-kpi-card pm-kpi-tone-blue">
          <div className="pm-kpi-top">
            <div className="pm-kpi-icon pm-kpi-icon-blue">
              <Icon name="file" size={20} />
            </div>
            <span className="pm-kpi-label">Total Applications</span>
          </div>
          <div className="pm-kpi-value-row">
            <span className="pm-kpi-value">{totalCount}</span>
          </div>
          <div className="pm-kpi-trend-row">
            <span className="pm-badge pm-badge-info">Platform-wise</span>
            <span className="pm-kpi-subtitle">Customer Pipeline</span>
          </div>
        </div>

        <div className="pm-kpi-card pm-kpi-tone-amber">
          <div className="pm-kpi-top">
            <div className="pm-kpi-icon pm-kpi-icon-amber">
              <Icon name="clock" size={20} />
            </div>
            <span className="pm-kpi-label">Pending Review</span>
          </div>
          <div className="pm-kpi-value-row">
            <span className="pm-kpi-value">{pendingCount}</span>
          </div>
          <div className="pm-kpi-trend-row">
            <span className="pm-badge pm-badge-warning">In Queue</span>
            <span className="pm-kpi-subtitle">Awaiting Decision</span>
          </div>
        </div>

        <div className="pm-kpi-card pm-kpi-tone-green">
          <div className="pm-kpi-top">
            <div className="pm-kpi-icon pm-kpi-icon-green">
              <Icon name="check" size={20} />
            </div>
            <span className="pm-kpi-label">Approved Pipeline</span>
          </div>
          <div className="pm-kpi-value-row">
            <span className="pm-kpi-value">{approvedCount}</span>
          </div>
          <div className="pm-kpi-trend-row">
            <span className="pm-badge pm-badge-success">Sanctioned</span>
            <span className="pm-kpi-subtitle">Passed Verification</span>
          </div>
        </div>

        <div className="pm-kpi-card pm-kpi-tone-purple">
          <div className="pm-kpi-top">
            <div className="pm-kpi-icon pm-kpi-icon-purple">
              <Icon name="shield" size={20} />
            </div>
            <span className="pm-kpi-label">Docs Required</span>
          </div>
          <div className="pm-kpi-value-row">
            <span className="pm-kpi-value">{docsNeededCount}</span>
          </div>
          <div className="pm-kpi-trend-row">
            <span className="pm-badge pm-badge-neutral">Pending Docs</span>
            <span className="pm-kpi-subtitle">Customer Action Needed</span>
          </div>
        </div>
      </div>

      <div className="pm-filter-bar pm-categories-filter-bar">
        <div className="pm-search-input">
          <Icon name="search" size={16} />
          <input
            placeholder="Search by customer, product or application ID..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="pm-hero-clear-btn" onClick={() => setSearch("")} title="Clear search">
              <Icon name="close" size={14} />
            </button>
          )}
        </div>

        <select className="pm-select" value={status ?? ""} onChange={(e) => setStatus(e.target.value || null)}>
          <option value="">All Status</option>
          {applicationStatuses.map((s) => (
            <option key={s.id} value={s.value}>
              {s.label}
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

        {(status || search || pageSizeOption !== "10") && (
          <button
            className="pm-btn pm-btn-outline"
            onClick={() => {
              setStatus(null);
              setSearch("");
              handlePageSizeChange("10");
            }}
          >
            <Icon name="filter-x" size={14} /> Reset Filters
          </button>
        )}
      </div>

      <div className="pm-card pm-categories-table-card">
        {loading ? (
          <LoadingSkeletonRows />
        ) : error ? (
          <ErrorState message={error} onRetry={fetchApplications} />
        ) : items.length === 0 ? (
          <EmptyState icon="file" title="No applications found" description="Applications submitted by customers will appear here." />
        ) : (
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead>
                <tr>
                  <th>Application ID</th>
                  <th>Customer</th>
                  <th>Product</th>
                  <th>Category</th>
                  <th>Applied Date</th>
                  <th>Last Updated</th>
                  <th>Status</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {items.map((a) => (
                  <tr key={a.id} style={{ cursor: "pointer" }} onClick={() => open("application-details", { applicationId: a.id })}>
                    <td>
                      <div className="pm-cat-name-cell">
                        <div className="pm-cat-icon-squircle">
                          <Icon name="file" size={16} />
                        </div>
                        <strong>{a.applicationNumber}</strong>
                      </div>
                    </td>
                    <td>{a.customerName}</td>
                    <td>{a.productName}</td>
                    <td>{a.categoryName}</td>
                    <td>{formatDate(a.submittedAt ?? a.createdAt)}</td>
                    <td>{formatDate(a.updatedAt)}</td>
                    <td>
                      <StatusBadge status={a.status} entityType="Application" />
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <button
                        className="pm-icon-btn pm-icon-btn-view"
                        onClick={() => open("application-details", { applicationId: a.id })}
                        title="View Application Details"
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

      <Pagination page={page} totalPages={totalPages} totalCount={totalCount} pageSize={pageSize} onPageChange={setPage} itemLabel="applications" />
    </div>
  );
}

