import { Badge } from "@omniconnect/ui";
import { useStatusConfigStore } from "../../stores/useStatusConfigStore";
import type { StatusEntityType, StatusTone } from "../../types/domain";

// Used only as a render fallback for the brief window before the Setup-configurable status list
// has loaded from the API (or if a brand-new enum value has no config row yet) - the database,
// via useStatusConfigStore, is the actual source of truth once loaded.
const FALLBACK_TONE: Record<string, StatusTone> = {
  Active: "success",
  Published: "success",
  Approved: "success",
  Completed: "success",
  PendingReview: "warning",
  Pending: "warning",
  Scheduled: "warning",
  UnderReview: "warning",
  DocumentsRequired: "warning",
  Submitted: "info",
  Draft: "neutral",
  Inactive: "danger",
  Rejected: "danger",
  Cancelled: "danger",
  Hidden: "danger",
  Expired: "danger",
};

const FALLBACK_LABEL: Record<string, string> = {
  PendingReview: "Pending Review",
  UnderReview: "Under Review",
  DocumentsRequired: "Documents Required",
};

export function StatusBadge({ status, entityType }: { status: string; entityType: StatusEntityType }) {
  const loaded = useStatusConfigStore((s) => s.loaded);
  const getLabel = useStatusConfigStore((s) => s.getLabel);
  const getTone = useStatusConfigStore((s) => s.getTone);

  const label = loaded ? getLabel(entityType, status) : FALLBACK_LABEL[status] ?? status;
  const tone = loaded ? getTone(entityType, status) : FALLBACK_TONE[status] ?? "neutral";

  // The platform badge, so a status here reads exactly like one in the host or another remote.
  return (
    <Badge tone={tone} dot>
      {label}
    </Badge>
  );
}

/**
 * For places that need just the label text outside a component's render (e.g. building chart
 * legend data in a .map()), where the rules of hooks don't allow calling a store hook. Reads the
 * store's current snapshot directly - fine here since the caller's component already re-renders
 * whenever the underlying list it's mapping over changes.
 */
export function formatStatusLabel(entityType: StatusEntityType, status: string): string {
  const state = useStatusConfigStore.getState();
  return state.loaded ? state.getLabel(entityType, status) : FALLBACK_LABEL[status] ?? status;
}
