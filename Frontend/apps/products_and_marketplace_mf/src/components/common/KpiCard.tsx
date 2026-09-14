import { Icon, type IconName } from "./Icon";
import type { Kpi } from "../../types/domain";
import "./KpiCard.css";

export type KpiTone = "blue" | "green" | "amber" | "purple" | "rose";

function formatValue(kpi: Kpi): string {
  if (kpi.format === "percent") return `${kpi.value}%`;
  if (kpi.format === "currency") return `₹${kpi.value.toLocaleString()}`;
  return kpi.value.toLocaleString();
}

export function KpiCard({
  kpi,
  icon,
  tone = "blue",
  subtitle = "vs last 7 days",
}: {
  kpi: Kpi;
  icon: IconName;
  tone?: KpiTone;
  subtitle?: string;
}) {
  const positive = kpi.changePercent >= 0;
  return (
    <div className={`pm-kpi-card pm-kpi-tone-${tone}`}>
      {/* Top Row: Icon on left, Label on right */}
      <div className="pm-kpi-top">
        <div className={`pm-kpi-icon pm-kpi-icon-${tone}`}>
          <Icon name={icon} size={20} />
        </div>
        <span className="pm-kpi-label">{kpi.label}</span>
      </div>

      {/* Metric Value */}
      <div className="pm-kpi-value-row">
        <span className="pm-kpi-value">{formatValue(kpi)}</span>
      </div>

      {/* Trend Row: Trend badge on left, Subtitle on right */}
      <div className="pm-kpi-trend-row">
        <span className={`pm-kpi-trend ${positive ? "positive" : "negative"}`}>
          <Icon name={positive ? "arrow-up" : "arrow-down"} size={12} className="pm-kpi-trend-arrow" />
          <span>{Math.abs(kpi.changePercent)}%</span>
        </span>
        <span className="pm-kpi-subtitle">{subtitle}</span>
      </div>
    </div>
  );
}

