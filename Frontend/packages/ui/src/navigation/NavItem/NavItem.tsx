import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { classNames } from '../../utils/classNames'
import styles from './NavItem.module.css'

export interface NavItemProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'children'> {
  icon?: ReactNode
  label: ReactNode
  active?: boolean
  /** Trailing content — a count pill, an "unreachable" badge, a chevron. */
  trailing?: ReactNode
}

/**
 * One row in the platform sidebar.
 *
 * Rendered as a <button> because that is what both remotes' portalled sub-navigations need; the
 * host's own rows stay NavLinks and pull the identical classes from `navItemStyles`. See the
 * stylesheet for the drift this collapses.
 */
export function NavItem({ icon, label, active, trailing, className, type = 'button', ...rest }: NavItemProps) {
  return (
    <button
      type={type}
      className={classNames(styles.navItem, active && styles.navItemActive, className)}
      aria-current={active ? 'page' : undefined}
      {...rest}
    >
      {icon ? <span className={styles.navIcon}>{icon}</span> : null}
      <span className={styles.navLabel}>{label}</span>
      {trailing}
    </button>
  )
}

export { styles as navItemStyles }
