import styles from './Charts.module.css';
import { TICKS, niceStep } from './chartMath';

export interface BarDatum {
  id: string;
  label: string;
  value: number;
}

export interface BarChartProps {
  data: BarDatum[];
  /** Read out for assistive technology, e.g. "Products per category". */
  ariaLabel: string;
  emptyText?: string;
}

const W = 600;
const H = 260;
const PAD = { top: 24, right: 12, bottom: 44, left: 36 };
const SERIES = 6;

/** Vertical bars with a gridded axis and the value above each bar. Coloured from CSS variables, never hex. */
export function BarChart({ data, ariaLabel, emptyText = 'Nothing to chart yet.' }: BarChartProps) {
  if (data.length === 0) return <p className={styles.empty}>{emptyText}</p>;

  const step = niceStep(Math.max(...data.map((d) => d.value)));
  const top = step * TICKS;
  const innerW = W - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const slot = innerW / data.length;
  const barW = Math.min(64, slot * 0.6);
  const y = (value: number) => PAD.top + innerH - (value / top) * innerH;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={styles.chart} role="img" aria-label={`${ariaLabel}: ${data.map((d) => `${d.label} ${d.value}`).join(', ')}`}>
      {Array.from({ length: TICKS + 1 }, (_, i) => {
        const value = i * step;
        return (
          <g key={value}>
            <line x1={PAD.left} x2={W - PAD.right} y1={y(value)} y2={y(value)} className={styles.grid} />
            <text x={PAD.left - 8} y={y(value)} className={styles.axis} textAnchor="end" dominantBaseline="middle">{value}</text>
          </g>
        );
      })}
      {data.map((d, i) => {
        const x = PAD.left + slot * i + (slot - barW) / 2;
        const height = Math.max(0, innerH - (y(d.value) - PAD.top));
        return (
          <g key={d.id}>
            <title>{`${d.label}: ${d.value}`}</title>
            <rect x={x} y={y(d.value)} width={barW} height={height} rx={4} className={`${styles.bar} ${styles[`series${i % SERIES}`]}`} />
            <text x={x + barW / 2} y={y(d.value) - 6} textAnchor="middle" className={styles.value}>{d.value}</text>
            <text x={x + barW / 2} y={H - PAD.bottom + 18} textAnchor="middle" className={styles.axis}>{d.label.length > 12 ? `${d.label.slice(0, 11)}…` : d.label}</text>
          </g>
        );
      })}
    </svg>
  );
}
