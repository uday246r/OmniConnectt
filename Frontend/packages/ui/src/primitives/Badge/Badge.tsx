import type { ReactNode } from 'react'
import { classNames } from '../../utils/classNames'
import styles from './Badge.module.css'

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'primary'

export interface BadgeProps {
  tone?: BadgeTone
  dot?: boolean
  children: ReactNode
  /**
   * Escape hatch for a caller that needs one extra property the tones do not cover — lead_mf's
   * audit "action" badge renders its value in a monospace face, for instance. Not for colour:
   * a new colour belongs in `BadgeTone` so every app gets it.
   */
  className?: string
}

export function Badge({ tone = 'neutral', dot, children, className }: BadgeProps) {
  return (
    <span className={classNames(styles.badge, styles[tone], className)}>
      {dot && <span className={styles.dot} aria-hidden="true" />}
      {children}
    </span>
  )
}
