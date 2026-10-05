import type { StatusTone } from '../../types/domain';
import styles from './Charts.module.css';

export interface DonutSegment {
  key: string;
  label: string;
  value: number;
  /** Drawn in this tone — a status's own colour from Setup. */
  tone: StatusTone;
}

export interface DonutChartProps {
  segments: DonutSegment[];
  /** The figure in the middle and what it counts, e.g. 36 / "Products". */
  centerValue: number;
  centerLabel: string;
  ariaLabel: string;
}

// A circle of radius 15.9155 has a circumference of 100, so a segment's length is simply its percentage.
const R = 15.9155;

/** A ring of segments, each coloured by its tone, with the total in the middle. */
export function DonutChart({ segments, centerValue, centerLabel, ariaLabel }: DonutChartProps) {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  let offset = 0;

  return (
    <svg viewBox="0 0 42 42" className={styles.donut} role="img" aria-label={`${ariaLabel}: ${segments.map((s) => `${s.label} ${s.value}`).join(', ')}`}>
      <circle cx="21" cy="21" r={R} fill="none" className={styles.track} strokeWidth="5" />
      {total > 0 &&
        segments.map((segment) => {
          const length = (segment.value / total) * 100;
          const circle = (
            <circle
              key={segment.key}
              cx="21"
              cy="21"
              r={R}
              fill="none"
              strokeWidth="5"
              className={styles[`tone_${segment.tone}`]}
              strokeDasharray={`${length} ${100 - length}`}
              strokeDashoffset={25 - offset}
            >
              <title>{`${segment.label}: ${segment.value}`}</title>
            </circle>
          );
          offset += length;
          return circle;
        })}
      <text x="21" y="20.5" textAnchor="middle" className={styles.centerValue}>{centerValue}</text>
      <text x="21" y="26" textAnchor="middle" className={styles.centerLabel}>{centerLabel}</text>
    </svg>
  );
}
