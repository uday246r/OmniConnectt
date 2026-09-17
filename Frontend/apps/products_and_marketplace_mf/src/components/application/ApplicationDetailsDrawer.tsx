import { isApprovalPending } from "../../services/httpClient";
import { useEffect, useState } from "react";
import { Drawer, DrawerSection } from "../drawer/Drawer";
import { Icon } from "../common/Icon";
import { StatusBadge, formatStatusLabel } from "../common/StatusBadge";
import { formatDate, formatDate as fmtDate } from "../../utils/fieldFormat";
import { useApplicationStore } from "../../stores/useApplicationStore";
import { useDrawerStore } from "../../stores/useDrawerStore";
import { useStatusConfigStore } from "../../stores/useStatusConfigStore";
import { usePermissions } from "../../permissions/PermissionContext";
import { PERMISSIONS } from "../../permissions/permissions";
import { applicationApi } from "../../services/applicationApi";
import type { ApplicationStatus } from "../../types/domain";
import { DocumentPreviewModal } from "../common/DocumentPreviewModal";
import type { IconName } from "../common/Icon";
import { useShallow } from "zustand/react/shallow";

function getStatusButtonConfig(value: string, color: string): { iconName: IconName; toneClass: string } {
  switch (value) {
    case "Approved":
      return { iconName: "check", toneClass: "pm-btn-status-approved" };
    case "Completed":
      return { iconName: "check", toneClass: "pm-btn-status-completed" };
    case "Rejected":
      return { iconName: "close", toneClass: "pm-btn-status-rejected" };
    case "Cancelled":
      return { iconName: "close", toneClass: "pm-btn-status-cancelled" };
    case "UnderReview":
      return { iconName: "clock", toneClass: "pm-btn-status-under-review" };
    case "DocumentsRequired":
      return { iconName: "file", toneClass: "pm-btn-status-docs" };
    case "Escalated":
      return { iconName: "arrow-up", toneClass: "pm-btn-status-escalated" };
    case "OnHold":
      return { iconName: "clock", toneClass: "pm-btn-status-hold" };
    case "Draft":
      return { iconName: "file", toneClass: "pm-btn-status-draft" };
    default:
      if (color === "success") return { iconName: "check", toneClass: "pm-btn-status-approved" };
      if (color === "danger") return { iconName: "close", toneClass: "pm-btn-status-rejected" };
      if (color === "warning") return { iconName: "clock", toneClass: "pm-btn-status-under-review" };
      return { iconName: "tag", toneClass: "pm-btn-status-outline" };
  }
}

export function ApplicationDetailsDrawer({ applicationId }: { applicationId: string }) {
  const { selected, selectedLoading, fetchApplicationById, clearSelected, updateStatus } = useApplicationStore(useShallow((s) => ({ selected: s.selected, selectedLoading: s.selectedLoading, fetchApplicationById: s.fetchApplicationById, clearSelected: s.clearSelected, updateStatus: s.updateStatus })));
  const { close } = useDrawerStore(useShallow((s) => ({ close: s.close })));
  const statusConfigs = useStatusConfigStore((s) => s.configs);
  const { has } = usePermissions();
  const [note, setNote] = useState("");
  const [updating, setUpdating] = useState(false);
  const [previewModal, setPreviewModal] = useState<{ url: string; title: string; fileName: string } | null>(null);

  const [statusMessage, setStatusMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    fetchApplicationById(applicationId);
    return () => clearSelected();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applicationId]);

  const app = selected;
  const canManage = has(PERMISSIONS.APPLICATIONS_MANAGE);
  const canApprove = has(PERMISSIONS.APPLICATIONS_APPROVE);
  const canReject = has(PERMISSIONS.APPLICATIONS_REJECT);

  async function handleStatusChange(status: ApplicationStatus, statusLabel: string) {
    setUpdating(true);
    setStatusMessage(null);
    try {
      await updateStatus(applicationId, status, note || undefined);
      setNote("");
      setStatusMessage({ type: "success", text: `Application status marked as ${statusLabel} successfully.` });
    } catch (err) {
      if (isApprovalPending(err)) return;
      setStatusMessage({ type: "error", text: (err as Error).message || "Failed to update status." });
    } finally {
      setUpdating(false);
    }
  }

  // Every enabled Application status configured in Setup is a valid transition target (minus the
  // current one) - status is no longer a fixed workflow graph, it's whatever Setup makes available.
  // A newly added custom status shows up here automatically, no code change needed.
  const availableActions = app
    ? statusConfigs
      .filter((c) => c.entityType === "Application" && c.enabled && c.value !== app.status)
      .slice()
      .sort((a, b) => a.sortOrder - b.sortOrder)
    : [];

  return (
    <Drawer
      isOpen
      onClose={close}
      icon={<Icon name={(app?.productIconKey as never) || "file"} size={20} />}
      title={app ? app.applicationNumber : "Loading..."}
      subtitle={app ? `${app.productName} · ${app.categoryName}` : undefined}
      badge={app && <StatusBadge status={app.status} entityType="Application" />}
    >
      {selectedLoading || !app ? (
        <div className="pm-skeleton" style={{ height: 240 }} />
      ) : (
        <>
          <DrawerSection title="Customer Information" icon="user">
            <div className="pm-detail-fields">
              <div className="pm-detail-field">
                <span>Name</span>
                <strong>{app.customerName}</strong>
              </div>
              <div className="pm-detail-field">
                <span>Email</span>
                <strong>{app.customerEmail}</strong>
              </div>
              <div className="pm-detail-field">
                <span>Phone</span>
                <strong>{app.customerPhone}</strong>
              </div>
              <div className="pm-detail-field">
                <span>Date of Birth</span>
                <strong>{app.customerDateOfBirth ? fmtDate(app.customerDateOfBirth) : "-"}</strong>
              </div>
              <div className="pm-detail-field">
                <span>Applied On</span>
                <strong>{fmtDate(app.submittedAt ?? app.createdAt)}</strong>
              </div>
            </div>
          </DrawerSection>

          <DrawerSection title="Submitted Information" icon="file-text">
            <div className="pm-detail-fields">
              {app.fieldValues.map((fv) => (
                <div className="pm-detail-field" key={fv.fieldKey}>
                  <span>{fv.fieldLabel}</span>
                  <strong>{fv.value}</strong>
                </div>
              ))}
            </div>
          </DrawerSection>

          <DrawerSection title="Documents" icon="file">
            <ul className="pm-doc-list">
              {app.documents.map((d) => (
                <li key={d.id}>
                  <span className="pm-doc-list-name">
                    <Icon name="file" size={16} />
                    {d.documentName}
                  </span>
                  <span className="pm-row-actions">
                    <span className={`pm-badge ${d.uploaded ? "pm-badge-success" : "pm-badge-warning"}`}>{d.uploaded ? "Uploaded" : "Pending"}</span>
                    {d.uploaded && (
                      <button
                        type="button"
                        className="pm-icon-btn"
                        title="Preview document"
                        onClick={() =>
                          setPreviewModal({
                            url: applicationApi.getDocumentFileUrl(app.id, d.id),
                            title: d.documentName,
                            fileName: d.documentName,
                          })
                        }
                      >
                        <Icon name="eye" size={14} />
                      </button>
                    )}
                  </span>
                </li>
              ))}
              {app.documents.length === 0 && <p className="pm-hint">No documents required.</p>}
            </ul>
          </DrawerSection>

          <DrawerSection title="Status Timeline" icon="clock">
            <ul className="pm-timeline">
              {app.statusHistory.map((h, i) => (
                <li key={i}>
                  <span className="pm-timeline-dot" />
                  <div className="pm-timeline-content">
                    <strong>{formatStatusLabel("Application", h.status)}</strong>
                    <p>
                      {h.note} · {formatDate(h.changedAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </DrawerSection>

          {app.reviewNotes && (
            <DrawerSection title="Review Notes" icon="message-square">
              <p className="pm-detail-description">{app.reviewNotes}</p>
            </DrawerSection>
          )}

          {canManage && availableActions.length > 0 && (
            <DrawerSection title="Update Status" icon="check-circle">
              {statusMessage && (
                <div className={`pm-status-feedback-banner ${statusMessage.type}`}>
                  <Icon name={statusMessage.type === "success" ? "check" : "info"} size={16} />
                  <span>{statusMessage.text}</span>
                </div>
              )}
              <div className="pm-field pm-mt-3">
                <label style={{ fontSize: 12, fontWeight: 600, color: "#64748b" }}>Note (optional)</label>
                <textarea
                  className="pm-input pm-note-input-compact"
                  rows={1}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder="Add a note for this status change..."
                />
              </div>
              <div className="pm-status-actions-grid pm-mt-3">
                {availableActions.map((c) => {
                  if (c.value === "Approved" && !canApprove) return null;
                  if (c.value === "Rejected" && !canReject) return null;
                  const { iconName, toneClass } = getStatusButtonConfig(c.value, c.color);
                  return (
                    <button
                      key={c.value}
                      className={`pm-status-chip ${toneClass}`}
                      disabled={updating}
                      onClick={() => handleStatusChange(c.value, c.label)}
                    >
                      <Icon name={iconName} size={13} className="pm-status-chip-icon" />
                      <span>Mark as {c.label}</span>
                    </button>
                  );
                })}
              </div>
            </DrawerSection>
          )}
        </>
      )}
      <DocumentPreviewModal
        isOpen={!!previewModal}
        fileUrl={previewModal?.url ?? null}
        title={previewModal?.title ?? ""}
        fileName={previewModal?.fileName}
        onClose={() => setPreviewModal(null)}
      />
    </Drawer>
  );
}
