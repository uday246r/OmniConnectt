import type { HTMLAttributes, ReactNode } from 'react'
import { classNames } from '../../utils/classNames'
import styles from './Card.module.css'

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  /** `sm` field tile · `md` section/summary card (default) · `lg` page panel. */
  size?: 'sm' | 'md' | 'lg'
  /** Lay the children out as an icon-plus-content row. */
  row?: boolean
  /** Hover lift. Only for a card that actually does something when clicked. */
  interactive?: boolean
  /** Draws the coloured top rule. Pass a colour, or `true` for the platform primary. */
  accent?: string | boolean
  children?: ReactNode
}

/**
 * The platform card.
 *
 * Consolidates a surface that had been copied by hand across both remotes and the host — see the
 * stylesheet for the byte-identical pairs it replaces.
 */
export function Card({
  size = 'md',
  row,
  interactive,
  accent,
  className,
  style,
  children,
  ...rest
}: CardProps) {
  return (
    <div
      className={classNames(
        styles.card,
        styles[size],
        row && styles.row,
        interactive && styles.interactive,
        accent && styles.accent,
        className
      )}
      style={
        typeof accent === 'string'
          ? ({ ...style, '--omni-card-accent': accent } as React.CSSProperties)
          : style
      }
      {...rest}
    >
      {children}
    </div>
  )
}
