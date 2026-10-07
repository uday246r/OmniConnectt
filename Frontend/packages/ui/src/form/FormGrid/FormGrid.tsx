import type { ReactNode } from 'react'
import { classNames } from '../../utils/classNames'
import styles from './FormGrid.module.css'

export interface FormGridProps {
  /** How many fields sit side by side on a wide screen. Always one on a narrow one. */
  columns?: 1 | 2 | 3
  children: ReactNode
  className?: string
}

/**
 * The field grid inside a {@link FormSection}: two across on a wide screen, one on a narrow one.
 *
 * A single field can span the full width with `<FormField full>`, which is how a textarea or an
 * address line sits under a pair of short fields without a grid of its own.
 */
export function FormGrid({ columns = 2, children, className }: FormGridProps) {
  return (
    <div className={classNames(styles.grid, styles[`cols${columns}`], className)}>{children}</div>
  )
}
