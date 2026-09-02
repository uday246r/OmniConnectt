import type { ReactNode } from 'react'
import { classNames } from '../../utils/classNames'
import styles from './EmptyState.module.css'

export interface EmptyStateProps {
  /**
   * The headline. Platform convention is "No {entities} found" — the host's dominant phrasing.
   * The same idea was written three ways across the apps ("No X found", "No X yet", "Nothing ...").
   */
  title: ReactNode
  /** Optional second line explaining what would put something here. */
  description?: ReactNode
  /** Typically an Icon at 32-40px. */
  icon?: ReactNode
  /** Optional call to action, e.g. a "Clear filters" Button. */
  action?: ReactNode
  /** Tighter padding, for use inside a card or drawer section rather than a full page. */
  compact?: boolean
  className?: string
}

/**
 * Empty state for cards, panels and drawer sections.
 *
 * For an empty TABLE, use `DataTable.Empty` instead — it renders as a row, so the column headers
 * and widths stay put rather than collapsing.
 */
export function EmptyState({ title, description, icon, action, compact, className }: EmptyStateProps) {
  return (
    <div className={classNames(styles.root, compact && styles.compact, className)}>
      {icon ? <div className={styles.icon}>{icon}</div> : null}
      <p className={styles.title}>{title}</p>
      {description ? <p className={styles.description}>{description}</p> : null}
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  )
}
