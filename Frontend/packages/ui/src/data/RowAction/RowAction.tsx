import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { classNames } from '../../utils/classNames'
import styles from './RowAction.module.css'

export interface RowActionProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** The action word. Defaults to the platform's verb, "View". */
  children?: ReactNode
  /** Trailing glyph, typically a chevron. Host's Approval Center passes one; Audit Logs does not. */
  trailing?: ReactNode
}

/**
 * The end-of-row button that opens a record's detail drawer.
 *
 * THE VERB IS "View", EVERYWHERE. The host says "View" on both its Approval Center and its Audit
 * Logs; lead_mf's audit log said "Inspect" and customer360_mf said "Inspect" in three places and
 * "Details" in a fourth. Four words for one action, so the same control read differently depending
 * on which app you were in. Defaulting `children` to "View" means a caller has to go out of its way
 * to reintroduce the drift.
 *
 * Global shared: host (2 pages), lead_mf (1), customer360_mf (3). Every copy was a
 * near-identical `.viewDetailBtn` / `.inspectBtn` rule; the tinted "Inspect" variants had also
 * drifted onto a different resting colour from the host's neutral one.
 */
export function RowAction({ children = 'View', trailing, className, type = 'button', ...rest }: RowActionProps) {
  return (
    <button type={type} className={classNames(styles.rowAction, className)} {...rest}>
      <span>{children}</span>
      {trailing}
    </button>
  )
}
