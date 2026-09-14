import { useState } from "react";
import "./Charts.css";

export function LineChart({ points, height = 220 }: { points: { label: string; value: number }[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length === 0) return null;

  const width = 640;
  const padding = 32;
  const maxValue = Math.max(...points.map((p) => p.value), 1);
  const stepX = (width - padding * 2) / Math.max(points.length - 1, 1);

  const coords = points.map((p, i) => ({
    x: padding + i * stepX,
    y: height - padding - (p.value / maxValue) * (height - padding * 2),
    ...p,
  }));

  const linePath = coords.map((c, i) => `${i === 0 ? "M" : "L"} ${c.x} ${c.y}`).join(" ");
  const areaPath = `${linePath} L ${coords[coords.length - 1].x} ${height - padding} L ${coords[0].x} ${height - padding} Z`;

  return (
    <div className="pm-chart-wrap">
      <svg viewBox={`0 0 ${width} ${height}`} className="pm-line-chart" preserveAspectRatio="none">
        <defs>
          <linearGradient id="pmAreaFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-primary)" stopOpacity="0.25" />
            <stop offset="100%" stopColor="var(--color-primary)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line key={f} x1={padding} x2={width - padding} y1={padding + f * (height - padding * 2)} y2={padding + f * (height - padding * 2)} className="pm-chart-gridline" />
        ))}
        <path d={areaPath} fill="url(#pmAreaFill)" stroke="none" />
        <path d={linePath} fill="none" stroke="var(--color-primary)" strokeWidth={2.5} />
        {coords.map((c, i) => (
          <g key={i} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
            <circle cx={c.x} cy={c.y} r={hover === i ? 5 : 3} fill="var(--color-primary)" stroke="#fff" strokeWidth={1.5} />
            <rect x={c.x - stepX / 2} y={0} width={stepX} height={height} fill="transparent" />
          </g>
        ))}
      </svg>
      <div className="pm-chart-x-labels">
        {points.map((p, i) => (
          <span key={i} className={hover === i ? "active" : ""}>
            {p.label}
          </span>
        ))}
      </div>
      {hover !== null && (
        <div
          className="pm-chart-tooltip"
          style={{ left: `${(coords[hover].x / width) * 100}%`, top: `${(coords[hover].y / height) * 100}%` }}
        >
          <strong>{points[hover].label}</strong>
          <span>{points[hover].value.toLocaleString()} applications</span>
        </div>
      )}
    </div>
  );
}
