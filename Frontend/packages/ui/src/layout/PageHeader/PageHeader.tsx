import type { ReactNode } from 'react'
import { classNames } from '../../utils/classNames'
import styles from './PageHeader.module.css'

export interface PageHeaderProps {
  title: ReactNode
  subtitle?: ReactNode
  /** Glyph shown in the glass tile at the left. Rendered at ~24px. */
  icon?: ReactNode
  /** Glass pill beside the title — a record count, a "live" indicator, an environment tag. */
  pill?: ReactNode
  /** Right-hand controls: date-range switchers, export buttons, refresh. */
  actions?: ReactNode
  className?: string
}

/**
 * The blue banner at the top of a page.
 *
 * Global shared: the host's Audit Logs and Approval Center render it, and so do lead_mf's View Leads
 * and Audit Logs. All four had their own copy, drifting on radius (18 vs 20), padding (24/30 vs
 * 28/32), gradient angle (120deg vs 135deg) and title size (20 vs 24) — while `theme.css` already
 * carried `--omni-gradient-page-header` and `--omni-shadow-page-header` waiting to be used.
 *
 * The consumer supplies content and actions; this owns the banner's shape entirely, including the
 * two decorative light blooms that every copy had reimplemented as positioned <div>s.
 */
export function PageHeader({ title, subtitle, icon, pill, actions, className }: PageHeaderProps) {
  return (
    <header className={classNames(styles.header, className)}>
      <div className={styles.left}>
        {icon ? <div className={styles.icon}>{icon}</div> : null}
        <div className={styles.titleGroup}>
          <div className={styles.titleRow}>
            <h1 className={styles.title}>{title}</h1>
            {pill ? <span className={styles.pill}>{pill}</span> : null}
          </div>
          {subtitle ? <p className={styles.subtitle}>{subtitle}</p> : null}
        </div>
      </div>
      {actions ? <div className={styles.actions}>{actions}</div> : null}
    </header>
  )
}

export { styles as pageHeaderStyles }
