import React from 'react';
import { SkeletonBlock } from '@omniremit/ui/skeleton';

/**
 * Loading states shaped like the pages they stand in for.
 *
 * These replace spinners and "Loading lead records from database..." text. A spinner tells you
 * something is happening; a shaped skeleton tells you what is about to arrive and reserves the space
 * for it, so the page does not jump when the data lands. The shimmer comes from @omniremit/ui, the
 * same one the host uses — lead_mf previously carried its own `.lead-skel` reimplementation of it.
 *
 * Column counts and paddings below deliberately mirror the real tables in ViewLeadPage and
 * FieldSettingsPage; if those change, these should change with them.
 */

const CELL: React.CSSProperties = { padding: '13px 18px', verticalAlign: 'middle' };

/** Mirrors ViewLeadPage's seven columns: Customer, IC, Contact, Product, Branch, Created, Actions. */
export const LeadTableSkeleton: React.FC<{ rows?: number }> = ({ rows = 8 }) => (
  <tbody>
    {Array.from({ length: rows }).map((_, i) => (
      <tr key={i} style={{ borderBottom: '1px solid #f1f5f9' }}>
        <td style={CELL}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <SkeletonBlock width={32} height={32} radius="50%" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
              <SkeletonBlock width={130} height={11} />
              <SkeletonBlock width={90} height={9} />
            </div>
          </div>
        </td>
        <td style={CELL}><SkeletonBlock width={110} height={11} /></td>
        <td style={CELL}><SkeletonBlock width={120} height={11} /></td>
        <td style={CELL}><SkeletonBlock width={100} height={11} /></td>
        <td style={CELL}><SkeletonBlock width={90} height={11} /></td>
        <td style={CELL}><SkeletonBlock width={80} height={11} /></td>
        <td style={{ ...CELL, textAlign: 'right' }}>
          <div style={{ display: 'inline-flex', gap: '6px' }}>
            <SkeletonBlock width={58} height={26} radius="7px" />
            <SkeletonBlock width={28} height={26} radius="7px" />
          </div>
        </td>
      </tr>
    ))}
  </tbody>
);

/** Mirrors FieldSettingsPage's section cards, each holding a list of field rows. */
export const FieldSettingsSkeleton: React.FC<{ sections?: number; rowsPerSection?: number }> = ({
  sections = 3,
  rowsPerSection = 4,
}) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
    {Array.from({ length: sections }).map((_, s) => (
      <div
        key={s}
        style={{
          background: '#ffffff',
          border: '1px solid #eaecf0',
          borderRadius: '14px',
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

/** Mirrors the create/edit lead form: a two-column grid of labelled inputs. */
export const LeadFormSkeleton: React.FC<{ groups?: number }> = ({ groups = 3 }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
    {Array.from({ length: groups }).map((_, g) => (
      <div
        key={g}
        style={{
          background: '#ffffff',
          border: '1px solid #eaecf0',
          borderRadius: '14px',
          padding: '20px',
        }}
      >
        <SkeletonBlock width={170} height={14} />
        <div
          style={{
            marginTop: '18px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
            gap: '16px',
          }}
        >
          {Array.from({ length: 4 }).map((_, f) => (
            <div key={f} style={{ display: 'flex', flexDirection: 'column', gap: '7px' }}>
              <SkeletonBlock width={90} height={10} />
              <SkeletonBlock width="100%" height={40} radius="9px" />
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
);
