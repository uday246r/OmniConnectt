import "./Charts.css";

const PALETTE = ["#2563eb", "#10b981", "#f59e0b", "#7c3aed", "#ec4899", "#64748b", "#06b6d4", "#ef4444"];

export function DonutChart({
  segments,
  total,
  centerLabel,
  size = 150,
}: {
  segments: { label: string; value: number; percentage: number }[];
  total: number;
  centerLabel?: string;
  size?: number;
}) {
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  let offset = 0;

  return (
    <div className="pm-donut-wrap">
      <svg viewBox="0 0 100 100" width={size} height={size} className="pm-donut">
        <circle cx="50" cy="50" r={radius} fill="none" stroke="#f1f5f9" strokeWidth="14" />
        {segments.map((s, i) => {
          const dash = (s.percentage / 100) * circumference;
          const circle = (
            <circle
              key={s.label}
              cx="50"
              cy="50"
              r={radius}
              fill="none"
              stroke={PALETTE[i % PALETTE.length]}
              strokeWidth="14"
              strokeDasharray={`${dash} ${circumference - dash}`}
              strokeDashoffset={-offset}
              transform="rotate(-90 50 50)"
              strokeLinecap={segments.length > 1 ? "butt" : "round"}
            />
          );
          offset += dash;
          return circle;
        })}
      </svg>
      <div className="pm-donut-center">
        <strong>{total.toLocaleString()}</strong>
        {centerLabel && <span>{centerLabel}</span>}
      </div>
    </div>
  );
}

export function DonutLegend({ segments }: { segments: { label: string; value: number; percentage: number }[] }) {
  return (
    <ul className="pm-donut-legend">
      {segments.map((s, i) => (
        <li key={s.label}>
          <div className="pm-donut-legend-left">
            <span className="pm-donut-legend-dot" style={{ background: PALETTE[i % PALETTE.length] }} />
            <span className="pm-donut-legend-label">{s.label}</span>
          </div>
          <span className="pm-donut-legend-value">
            {s.value.toLocaleString()} <span className="pm-donut-legend-pct">({s.percentage}%)</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

