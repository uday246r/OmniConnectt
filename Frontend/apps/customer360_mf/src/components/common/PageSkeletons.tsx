import React from 'react';
import { SkeletonBlock } from '@omniremit/ui/skeleton';

/**
 * Loading states shaped like the pages they stand in for.
 *
 * Replaces the spinner-and-sentence pattern these pages used ("Loading customer product
 * accounts..."). A spinner says something is happening; a shaped skeleton says what is coming and
 * holds its space, so nothing jumps when the data lands.
 *
 * The shimmer comes from @omniremit/ui — the same one the host and lead_mf use. customer360
 * previously carried its own `.c360-skel` reimplementation of it, which is exactly the kind of
 * near-identical copy that drifts.
 */

interface TableSkeletonProps {
  /** Match the real table so the header does not shift when rows arrive. */
  columns?: number;
  rows?: number;
}

/** Generic row skeleton for the audit, interactions and products tables. */
export const C360TableSkeleton: React.FC<TableSkeletonProps> = ({ columns = 6, rows = 8 }) => (
  <tbody>
    {Array.from({ length: rows }).map((_, r) => (
      <tr key={r} style={{ borderBottom: '1px solid #f1f5f9' }}>
        {Array.from({ length: columns }).map((_, c) => (
          <td key={c} style={{ padding: '13px 16px', verticalAlign: 'middle' }}>
            {/* Varying widths so it reads as data rather than a block of identical bars. */}
            <SkeletonBlock width={c === 0 ? 150 : c === columns - 1 ? 70 : 100 + ((r + c) % 3) * 22} height={11} />
          </td>
        ))}
      </tr>
    ))}
  </tbody>
);

/** Card-list shape used by All Interactions and All Products when they render cards, not rows. */
export const C360CardListSkeleton: React.FC<{ cards?: number }> = ({ cards = 5 }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
    {Array.from({ length: cards }).map((_, i) => (
      <div
        key={i}
        style={{
          background: '#ffffff',
          border: '1px solid #e5e7eb',
          borderRadius: '12px',
          padding: '16px 18px',
          display: 'flex',
          alignItems: 'center',
          gap: '14px',
        }}
      >
        <SkeletonBlock width={40} height={40} radius="10px" />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '7px' }}>
          <SkeletonBlock width={`${45 + (i % 3) * 12}%`} height={12} />
          <SkeletonBlock width={`${28 + (i % 4) * 9}%`} height={10} />
        </div>
        <SkeletonBlock width={72} height={24} radius="999px" />
      </div>
    ))}
  </div>
);

/** Mirrors Field Settings: section cards each holding a list of per-field toggle rows. */
export const C360FieldSettingsSkeleton: React.FC<{ sections?: number; rowsPerSection?: number }> = ({
  sections = 3,
  rowsPerSection = 4,
}) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
    {Array.from({ length: sections }).map((_, s) => (
      <div
        key={s}
        style={{
          background: '#ffffff',
          border: '1px solid #e5e7eb',
          borderRadius: '12px',
          padding: '18px 20px',
        }}
      >
        <div style={{ marginBottom: '16px', display: 'flex', flexDirection: 'column', gap: '6px' }}>
          <SkeletonBlock width={180} height={14} />
          <SkeletonBlock width={260} height={10} />
        </div>
        {Array.from({ length: rowsPerSection }).map((_, r) => (
          <div
            key={r}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              padding: '11px 0',
              borderTop: r === 0 ? 'none' : '1px solid #f1f5f9',
            }}
          >
            <SkeletonBlock width={200} height={12} />
            <div style={{ display: 'flex', gap: '10px' }}>
              <SkeletonBlock width={40} height={20} radius="999px" />
              <SkeletonBlock width={40} height={20} radius="999px" />
              <SkeletonBlock width={40} height={20} radius="999px" />
            </div>
          </div>
        ))}
      </div>
    ))}
  </div>
);
