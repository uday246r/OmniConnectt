import type { ReactNode } from 'react';
import { formatChange, formatNumber } from '../utils/format';
import styles from './KpiTile.module.css';

export type KpiAccent = 'primary' | 'success' | 'warning' | 'info' | 'danger';

export interface KpiTileProps {
  label: string;
  value: number;
  icon: ReactNode;
  accent: KpiAccent;
  /** The change against an earlier date. Omit for a figure with no comparison. */
  changePercent?: number;
  /** What the change is measured against, e.g. "vs last 30 days". */
  changeLabel?: string;
  caption?: string;
}

/** One headline figure: an icon, its name, its value and how it has moved. */
export function KpiTile({ label, value, icon, accent, changePercent, changeLabel, caption }: KpiTileProps) {
  const direction = changePercent === undefined || changePercent === 0 ? 'flat' : changePercent > 0 ? 'up' : 'down';
  return (
    <article className={`${styles.tile} ${styles[accent]}`} aria-label={label}>
      <div className={styles.head}>
        <span className={styles.icon} aria-hidden="true">{icon}</span>
        <div className={styles.numbers}>
          <span className={styles.label}>{label}</span>
          <span className={styles.value}>{formatNumber(value)}</span>
        </div>
      </div>
      <div className={styles.foot}>
        {changePercent !== undefined && (
          <span className={`${styles.change} ${styles[direction]}`}>
            <span aria-hidden="true">{direction === 'up' ? '↑' : direction === 'down' ? '↓' : '→'}</span>
            <strong>{formatChange(changePercent)}</strong>
            {changeLabel && <span className={styles.changeLabel}>{changeLabel}</span>}
          </span>
        )}
        {caption && <span className={styles.caption}>{caption}</span>}
      </div>
    </article>
  );
}
