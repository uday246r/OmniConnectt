import { useEffect, useState } from "react";
import { Icon } from "../components/common/Icon";
import { StatusBadge } from "../components/common/StatusBadge";
import { Pagination } from "../components/common/Pagination";
import { EmptyState, ErrorState, LoadingSkeletonRows } from "../components/common/EmptyState";
import { ConfirmModal } from "../components/common/ConfirmModal";
import { CustomSelect } from "../components/common/CustomSelect";
import { usePromotionStore } from "../stores/usePromotionStore";
import { useDrawerStore } from "../stores/useDrawerStore";
import { useStatusConfigStore } from "../stores/useStatusConfigStore";
import { useToastStore } from "../stores/useToastStore";
import { usePermissions } from "../permissions/PermissionContext";
import { PERMISSIONS } from "../permissions/permissions";
import { formatDate } from "../utils/fieldFormat";
import type { Promotion } from "../types/domain";

export function PromotionsPage() {
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
    fetchPromotions,
    updateStatus,
    removePromotion,
  } = usePromotionStore();
  const { open } = useDrawerStore();
  const { configs: statusConfigs, fetchAll: fetchStatusConfigs } = useStatusConfigStore();
  const { has } = usePermissions();
  const canCreate = has(PERMISSIONS.PROMOTIONS_CREATE);
  const canEdit = has(PERMISSIONS.PROMOTIONS_EDIT);
  const canDelete = has(PERMISSIONS.PROMOTIONS_DELETE);

  const [deleteTarget, setDeleteTarget] = useState<Promotion | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);
  const [pageSizeOption, setPageSizeOption] = useState<string>("10");
  const [customPageSize, setCustomPageSize] = useState<number>(15);

  const promotionStatuses = statusConfigs
    .filter((c) => c.entityType === "Promotion" && c.enabled)
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
    fetchPromotions();
  }, [search, status, page, pageSize, fetchPromotions]);

  const activeCount = items.filter((p) => p.status === "Active").length;
  const scheduledCount = items.filter((p) => p.status === "Scheduled").length;
  const draftCount = items.filter((p) => p.status === "Draft").length;

  async function handleConfirmDelete() {
    if (!deleteTarget) return;
    const title = deleteTarget.title;
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await removePromotion(deleteTarget.id);
      setDeleteTarget(null);
      useToastStore.getState().success("Promotion Deleted", `"${title}" has been deleted successfully.`);
    } catch (err) {
      setDeleteError((err as Error).message);
      useToastStore.getState().danger("Delete Failed", (err as Error).message);
    } finally {
      setIsDeleting(false);
    }
  }

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
    <div className="pm-page pm-promotions-page">
      <div className="pm-hero-banner">
        <div className="pm-hero-banner-content">
          <div className="pm-hero-icon-wrap">
            <Icon name="tag" size={26} />
          </div>
          <div className="pm-hero-text">
            <div className="pm-hero-badge-row">
              <span className="pm-hero-live-badge">• Active Campaigns</span>
              <span className="pm-hero-date">{todayFormatted}</span>
            </div>
            <h1>Promotions & Campaigns</h1>
            <p>Create, schedule, prioritize, and monitor marketing campaigns and product incentives.</p>
          </div>
        </div>
        {canCreate && (
          <div className="pm-hero-actions">
            <button className="pm-btn pm-hero-add-btn" onClick={() => open("promotion-form", {})}>
              <Icon name="plus" size={16} /> Add Promotion
            </button>
          </div>
        )}
      </div>

      <div className="pm-kpi-grid">
        <div className="pm-kpi-card pm-kpi-tone-blue">
          <div className="pm-kpi-top">
            <div className="pm-kpi-icon pm-kpi-icon-blue">
              <Icon name="tag" size={20} />
            </div>
            <span className="pm-kpi-label">Total Promotions</span>
          </div>
          <div className="pm-kpi-value-row">
            <span className="pm-kpi-value">{totalCount}</span>
          </div>
          <div className="pm-kpi-trend-row">
            <span className="pm-badge pm-badge-info">Platform-wise</span>
            <span className="pm-kpi-subtitle">Campaign Roster</span>
          </div>
        </div>

        <div className="pm-kpi-card pm-kpi-tone-green">
          <div className="pm-kpi-top">
            <div className="pm-kpi-icon pm-kpi-icon-green">
              <Icon name="check" size={20} />
            </div>
            <span className="pm-kpi-label">Active Campaigns</span>
          </div>
          <div className="pm-kpi-value-row">
            <span className="pm-kpi-value">{activeCount}</span>
          </div>
          <div className="pm-kpi-trend-row">
            <span className="pm-badge pm-badge-success">Live</span>
            <span className="pm-kpi-subtitle">Running in App</span>
          </div>
        </div>

        <div className="pm-kpi-card pm-kpi-tone-purple">
          <div className="pm-kpi-top">
            <div className="pm-kpi-icon pm-kpi-icon-purple">
              <Icon name="calendar" size={20} />
            </div>
            <span className="pm-kpi-label">Scheduled Offers</span>
          </div>
          <div className="pm-kpi-value-row">
            <span className="pm-kpi-value">{scheduledCount}</span>
          </div>
          <div className="pm-kpi-trend-row">
            <span className="pm-badge pm-badge-neutral">Upcoming</span>
            <span className="pm-kpi-subtitle">Queued Releases</span>
          </div>
        </div>

        <div className="pm-kpi-card pm-kpi-tone-amber">
          <div className="pm-kpi-top">
            <div className="pm-kpi-icon pm-kpi-icon-amber">
              <Icon name="edit" size={20} />
            </div>
            <span className="pm-kpi-label">Draft Offers</span>
          </div>
          <div className="pm-kpi-value-row">
            <span className="pm-kpi-value">{draftCount}</span>
          </div>
          <div className="pm-kpi-trend-row">
            <span className="pm-badge pm-badge-warning">Draft</span>
            <span className="pm-kpi-subtitle">In Configuration</span>
          </div>
        </div>
      </div>

      <div className="pm-filter-bar pm-categories-filter-bar">
        <div className="pm-search-input">
          <Icon name="search" size={16} />
          <input
            placeholder="Search promotions by title or product..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="pm-hero-clear-btn" onClick={() => setSearch("")} title="Clear search">
              <Icon name="close" size={14} />
            </button>
          )}
        </div>

        <CustomSelect
          options={[
            { value: "", label: "All Status" },
            ...promotionStatuses.map((s) => ({ value: s.value, label: s.label })),
          ]}
          value={status ?? ""}
          onChange={(val) => setStatus(val || null)}
          placeholder="All Status"
        />

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
          <ErrorState message={error} onRetry={fetchPromotions} />
        ) : items.length === 0 ? (
          <EmptyState icon="tag" title="No promotions found" description="Create a promotion to boost visibility and applications for a product." />
        ) : (
          <div className="pm-table-wrap">
            <table className="pm-table">
              <thead>
                <tr>
                  <th>Title</th>
                  <th>Product</th>
                  <th>Badge</th>
                  <th>Start</th>
                  <th>End</th>
                  <th>Priority</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {items.map((p) => (
                  <tr key={p.id} style={{ cursor: "pointer" }} onClick={() => open("promotion-details", { promotionId: p.id })}>
                    <td>
                      <div className="pm-cat-name-cell">
                        <div className="pm-cat-icon-squircle">
                          <Icon name="tag" size={16} />
                        </div>
                        <strong>{p.title}</strong>
                      </div>
                    </td>
                    <td>{p.productName}</td>
                    <td>
                      <span className="pm-badge pm-badge-warning">{p.badgeText || "-"}</span>
                    </td>
                    <td>{formatDate(p.startDate)}</td>
                    <td>{formatDate(p.endDate)}</td>
                    <td>
                      <span className="pm-badge pm-badge-neutral">Priority {p.priority}</span>
                    </td>
                    <td>
                      <StatusBadge status={p.status} entityType="Promotion" />
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="pm-row-actions">
                        <button
                          className="pm-icon-btn pm-icon-btn-view"
                          onClick={() => open("promotion-details", { promotionId: p.id })}
                          title="View promotion details"
                        >
                          <Icon name="eye" size={14} />
                        </button>
                        {canEdit && (
                          <button
                            className="pm-icon-btn pm-icon-btn-edit"
                            onClick={() => open("promotion-form", { promotionId: p.id })}
                            title="Edit promotion"
                          >
                            <Icon name="edit" size={14} />
                          </button>
                        )}
                        {canEdit && p.status !== "Active" && p.status !== "Expired" && (
                          <button
                            className="pm-icon-btn"
                            title="Activate promotion"
                            onClick={() => updateStatus(p.id, "Active")}
                          >
                            <Icon name="check" size={14} />
                          </button>
                        )}
                        {canDelete && (
                          <button
                            className="pm-icon-btn pm-icon-btn-delete"
                            onClick={() => {
                              setDeleteTarget(p);
                              setDeleteError(null);
                            }}
                            title="Delete promotion"
                          >
                            <Icon name="trash" size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <Pagination page={page} totalPages={totalPages} totalCount={totalCount} pageSize={pageSize} onPageChange={setPage} itemLabel="promotions" />

      <ConfirmModal
        isOpen={!!deleteTarget}
        title="Delete Promotion"
        message="Are you sure you want to permanently delete this promotion offer? This action cannot be undone."
        entityName={deleteTarget?.title}
        details={deleteTarget ? [
          { label: "Campaign Title", value: deleteTarget.title },
          { label: "Target Product", value: deleteTarget.productName },
          { label: "Badge Tag", value: deleteTarget.badgeText || "None" },
          { label: "Campaign Status", value: deleteTarget.status },
          { label: "Display Priority", value: `#${deleteTarget.priority}` },
          { label: "Active Window", value: `${formatDate(deleteTarget.startDate)} to ${formatDate(deleteTarget.endDate)}` },
        ] : undefined}
        confirmText="Delete Promotion"
        variant="danger"
        isLoading={isDeleting}
        errorMessage={deleteError}
        onCancel={() => {
          setDeleteTarget(null);
          setDeleteError(null);
        }}
        onConfirm={handleConfirmDelete}
      />
    </div>
  );
}


