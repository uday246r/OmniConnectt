import { useStatusConfigStore } from "../../stores/useStatusConfigStore";
import type { StatusCount, StatusEntityType, StatusTone } from "../../types/domain";
import { Icon, type IconName } from "./Icon";
import type { KpiTone } from "./KpiCard";
import "./KpiCard.css";

const CARD_TONE: Record<StatusTone, KpiTone> = {
  success: "green",
  warning: "amber",
  danger: "rose",
  info: "blue",
  neutral: "purple",
};

const TONE_ICON: Record<StatusTone, IconName> = {
  success: "check",
  warning: "clock",
  danger: "close",
  info: "info",
  neutral: "tag",
};

/** How many per-status cards follow the total. The rest are still reachable through the status filter. */
const STATUS_CARD_LIMIT = 3;

/**
 * A total and the busiest statuses, as counted by the server for the whole filtered set.
 *
 * These cards used to be written per page — "Pending Review", "Approved Pipeline", "Docs Required" —
 * each counting the rows on the page on screen and naming status values in code, although statuses
 * are configured in Setup. They are now built from the server's per-status counts, labelled and
 * coloured by that configuration, so a renamed or newly added status shows up without a code change.
 */
export function StatusCountCards({
  entityType,
  counts,
  totalLabel,
  totalIcon,
  loading,
}: {
  entityType: StatusEntityType;
  counts: StatusCount[] | null;
  totalLabel: string;
  totalIcon: IconName;
  loading: boolean;
}) {
  const getLabel = useStatusConfigStore((s) => s.getLabel);
  const getTone = useStatusConfigStore((s) => s.getTone);

  const total = counts?.reduce((sum, c) => sum + c.count, 0) ?? null;
  const busiest = [...(counts ?? [])].sort((a, b) => b.count - a.count || a.status.localeCompare(b.status)).slice(0, STATUS_CARD_LIMIT);
  const value = (n: number | null) => (loading && n === null ? "—" : (n ?? 0).toLocaleString());

  return (
    <div className="pm-kpi-grid" aria-busy={loading}>
      <div className="pm-kpi-card pm-kpi-tone-blue">
        <div className="pm-kpi-top">
          <div className="pm-kpi-icon pm-kpi-icon-blue">
            <Icon name={totalIcon} size={20} />
          </div>
          <span className="pm-kpi-label">{totalLabel}</span>
        </div>
        <div className="pm-kpi-value-row">
          <span className="pm-kpi-value">{value(total)}</span>
        </div>
      </div>

      {busiest.map((c) => {
        const tone = getTone(entityType, c.status);
        const cardTone = CARD_TONE[tone] ?? "purple";
        return (
          <div key={c.status} className={`pm-kpi-card pm-kpi-tone-${cardTone}`}>
            <div className="pm-kpi-top">
              <div className={`pm-kpi-icon pm-kpi-icon-${cardTone}`}>
                <Icon name={TONE_ICON[tone] ?? "tag"} size={20} />
              </div>
              <span className="pm-kpi-label">{getLabel(entityType, c.status)}</span>
            </div>
            <div className="pm-kpi-value-row">
              <span className="pm-kpi-value">{c.count.toLocaleString()}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
