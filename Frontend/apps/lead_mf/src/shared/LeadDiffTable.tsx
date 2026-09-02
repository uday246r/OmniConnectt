import React from 'react';
import { DataTable } from '@omniremit/ui';
import styles from './LeadDiffTable.module.css';

export interface LeadFieldDiff {
  field: string;
  previousValue: React.ReactNode;
  newValue: React.ReactNode;
}

export interface LeadDiffTableProps {
  diffs: LeadFieldDiff[];
  /** Column heading for the left value column. */
  previousLabel?: string;
  /** Column heading for the right value column. */
  newLabel?: string;
}

/**
 * Before/after view of changed fields.
 *
 * APPLICATION-LEVEL SHARED, deliberately — it lives in lead_mf rather than @omniremit/ui because
 * only this app renders it, in two places: the Edit Lead confirmation step and the Audit Record
 * details drawer. Both had their own copy, and they had drifted (different greens, different
 * paddings, one monospaced and one not). Promote this to the shared package only if a second
 * application needs the same presentation.
 *
 * It is NOT folded into DataTable itself: the red/green column semantics are what make this a diff
 * rather than a listing. It renders through `DataTable bare` so it still inherits the platform's
 * header treatment and row rhythm without the outer card chrome, since both call sites already sit
 * inside a framed section.
 */
export const LeadDiffTable: React.FC<LeadDiffTableProps> = ({
  diffs,
  previousLabel = 'Previous Value',
  newLabel = 'New Value',
}) => {
  return (
    <div className={styles.frame}>
      <DataTable bare>
        <thead>
          <tr>
            <th>Field</th>
            <th className={styles.thPrevious}>{previousLabel}</th>
            <th className={styles.thNew}>{newLabel}</th>
          </tr>
        </thead>
        <tbody>
          {diffs.map((diff, idx) => (
            <tr key={`${diff.field}-${idx}`}>
              <td className={styles.fieldCell}>{diff.field}</td>
              <td className={`${styles.valueCell} ${styles.previousValue}`}>
                {isEmpty(diff.previousValue) ? <span className={styles.emptyValue}>empty</span> : diff.previousValue}
              </td>
              <td className={`${styles.valueCell} ${styles.newValue}`}>
                {isEmpty(diff.newValue) ? <span className={styles.emptyValue}>empty</span> : diff.newValue}
              </td>
            </tr>
          ))}
        </tbody>
      </DataTable>
    </div>
  );
};

/** A blank before-value is meaningful in a diff (the field was previously unset), so it is labelled
 *  rather than rendered as an empty cell the reader has to interpret. */
function isEmpty(value: React.ReactNode): boolean {
  return value === null || value === undefined || value === '';
}
