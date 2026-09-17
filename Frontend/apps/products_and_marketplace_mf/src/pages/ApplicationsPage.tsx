import { Pagination, PageHeader } from "@omniconnect/ui";
import { useEffect, useState } from "react";
import { CustomSelect } from "../components/common/CustomSelect";
import { Icon } from "../components/common/Icon";
import { StatusBadge } from "../components/common/StatusBadge";
import { StatusCountCards } from "../components/common/StatusCountCards";
import { EmptyState, ErrorState, LoadingSkeletonRows } from "../components/common/EmptyState";
import { useApplicationStore } from "../stores/useApplicationStore";
import { useDrawerStore } from "../stores/useDrawerStore";
import { useStatusConfigStore } from "../stores/useStatusConfigStore";
import { formatDate } from "../utils/fieldFormat";
import { useShallow } from "zustand/react/shallow";

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
    statusCounts,
    setSearch,
    setStatus,
    setPage,
    setPageSize,
    fetchApplications,
  } = useApplicationStore(useShallow((s) => ({ items: s.items, loading: s.loading, error: s.error, search: s.search, status: s.status, page: s.page, pageSize: s.pageSize, totalCount: s.totalCount, statusCounts: s.statusCounts, setSearch: s.setSearch, setStatus: s.setStatus, setPage: s.setPage, setPageSize: s.setPageSize, fetchApplications: s.fetchApplications })));
  const { open } = useDrawerStore(useShallow((s) => ({ open: s.open })));
  const { configs: statusConfigs, fetchAll: fetchStatusConfigs } = useStatusConfigStore(useShallow((s) => ({ configs: s.configs, fetchAll: s.fetchAll })));

  const [pageSizeOption, setPageSizeOption] = useState<string>("10");
  const [customPageSize, setCustomPageSize] = useState<number>(15);

  const applicationStatuses = statusConfigs
    .filter((c) => c.entityType === "Application" && c.enabled)
    .sort((a, b) => a.sortOrder - b.sortOrder);

  useEffect(() => {
    fetchStatusConfigs();
  }, [fetchStatusConfigs]);

  useEffect(() => {
    fetchApplications();
  }, [search, status, page, pageSize, fetchApplications]);

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
      <PageHeader
        title="Application Pipeline"
        subtitle="Review, evaluate, verify documents, and process customer product applications."
        icon={<Icon name="file" size={24} />}
      />

      <StatusCountCards entityType="Application" counts={statusCounts} totalLabel="Applications" totalIcon="file" loading={loading} />

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

        <div className="pm-filter-combo">
          <CustomSelect
            aria-label="Status"
            options={[{ value: "", label: "All Status" }, ...applicationStatuses.map((s) => ({ value: s.value, label: s.label }))]}
            value={status ?? ""}
            onChange={(v) => setStatus(v || null)}
          />
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

      <Pagination page={page} total={totalCount} pageSize={pageSize} onPageChange={setPage} itemLabel="application" />
    </div>
  );
}

