import { useEffect, useState } from "react";
import { Drawer, DrawerSection } from "../drawer/Drawer";
import { Icon } from "../common/Icon";
import { useAuditLogStore } from "../../stores/useAuditLogStore";
import { useDrawerStore } from "../../stores/useDrawerStore";
import { auditLogApi } from "../../services/auditLogApi";
import { formatDate } from "../../utils/fieldFormat";
import type { AuditLog } from "../../types/domain";
import "../drawer/DrawerContent.css";

function formatAction(action: string): string {
  return action
    .replace(/[._]/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w[0].toUpperCase() + w.slice(1))
    .join(" ");
}

export function AuditLogDetailsDrawer({ auditLogId }: { auditLogId: string }) {
  const { items } = useAuditLogStore();
  const { close } = useDrawerStore();
  const [entry, setEntry] = useState<AuditLog | null>(items.find((i) => i.id === auditLogId) ?? null);
  const [loading, setLoading] = useState(!entry);

  useEffect(() => {
    if (entry) return;
    setLoading(true);
    auditLogApi.getById(auditLogId).then((data) => {
      setEntry(data);
      setLoading(false);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditLogId]);

  return (
    <Drawer
      isOpen
      onClose={close}
      icon={<Icon name="shield" size={20} />}
      title="Audit Record Details"
      subtitle="Full event context, initiator, and execution metadata"
      badge={entry && <span className={`pm-badge ${entry.success ? "pm-badge-success" : "pm-badge-danger"}`}>{entry.success ? "Success" : "Failed"}</span>}
    >
      {loading || !entry ? (
        <div className="pm-skeleton" style={{ height: 220 }} />
      ) : (
        <>
          <DrawerSection title="Overview" icon="grid">
            <div className="pm-detail-fields">
              <div className="pm-detail-field">
                <span>Service</span>
                <strong>
                  <span className="pm-badge pm-badge-info">ProductMarketplace</span>
                </strong>
              </div>
              <div className="pm-detail-field">
                <span>Action</span>
                <strong>
                  <span className="pm-badge pm-badge-neutral">{formatAction(entry.action)}</span>
                </strong>
              </div>
              <div className="pm-detail-field">
                <span>Result</span>
                <strong>
                  <span className={`pm-badge ${entry.success ? "pm-badge-success" : "pm-badge-danger"}`}>
                    {entry.success ? "• Success" : "• Failed"}
                  </span>
                </strong>
              </div>
              <div className="pm-detail-field">
                <span>Timestamp</span>
                <strong>{formatDate(entry.timestamp, { day: "2-digit", month: "short", year: "numeric" })} · {new Date(entry.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</strong>
              </div>
            </div>
          </DrawerSection>

          <DrawerSection title="Event Timeline" icon="clock">
            <ul className="pm-timeline">
              <li>
                <span className="pm-timeline-dot" />
                <div className="pm-timeline-content">
                  <strong>Initiated by {entry.actorName}</strong>
                  <p>{formatDate(entry.timestamp, { day: "2-digit", month: "short", year: "numeric" })} · {new Date(entry.timestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}</p>
                </div>
              </li>
              <li>
                <span className="pm-timeline-dot" style={{ background: entry.success ? "#10b981" : "#ef4444" }} />
                <div className="pm-timeline-content">
                  <strong>Event {entry.success ? "Completed Successfully" : "Encountered Error"}</strong>
                  <p>Product Marketplace</p>
                </div>
              </li>
            </ul>
          </DrawerSection>

          <DrawerSection title="Initiator & Authentication Context" icon="user">
            <div className="pm-detail-fields">
              <div className="pm-detail-field">
                <span>Initiated By</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
                  <div style={{ width: 22, height: 22, borderRadius: "50%", background: "#eff6ff", color: "#2563eb", fontSize: 11, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    {entry.actorName.charAt(0)}
                  </div>
                  <strong>{entry.actorName}</strong>
                </div>
              </div>
              <div className="pm-detail-field">
                <span>User Role</span>
                <strong>
                  <span className="pm-badge pm-badge-info">Administrator</span>
                </strong>
              </div>
              <div className="pm-detail-field" style={{ gridColumn: "1 / -1" }}>
                <span>Client IP (IPv4)</span>
                <strong>
                  <span className="pm-badge pm-badge-neutral">• {entry.ipAddress || "127.0.0.1"}</span>
                </strong>
              </div>
            </div>
          </DrawerSection>

          <DrawerSection title="Target Entity Context" icon="package">
            <div className="pm-detail-fields">
              <div className="pm-detail-field">
                <span>Entity Type</span>
                <strong>
                  <span className="pm-badge pm-badge-info">{entry.entityType}</span>
                </strong>
              </div>
              <div className="pm-detail-field">
                <span>Entity Name</span>
                <strong>{entry.entityName || "-"}</strong>
              </div>
              <div className="pm-detail-field" style={{ gridColumn: "1 / -1" }}>
                <span>Event Description</span>
                <strong style={{ fontWeight: 600, fontSize: 13, lineHeight: 1.5 }}>{entry.description}</strong>
              </div>
              {entry.entityId && (
                <div className="pm-detail-field" style={{ gridColumn: "1 / -1" }}>
                  <span>Entity ID</span>
                  <strong style={{ fontFamily: "monospace", fontSize: 12 }}>{entry.entityId}</strong>
                </div>
              )}
            </div>
          </DrawerSection>

          {(entry.previousValue || entry.newValue) && (
            <DrawerSection title="State Change" icon="refresh-cw">
              <div className="pm-detail-fields">
                <div className="pm-detail-field">
                  <span>Previous Value</span>
                  <strong>{entry.previousValue ?? "-"}</strong>
                </div>
                <div className="pm-detail-field">
                  <span>New Value</span>
                  <strong>{entry.newValue ?? "-"}</strong>
                </div>
              </div>
            </DrawerSection>
          )}
        </>
      )}
    </Drawer>
  );
}
