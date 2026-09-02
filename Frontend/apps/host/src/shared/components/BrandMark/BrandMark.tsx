import { classNames } from '../../utils/classNames'
import styles from './BrandMark.module.css'

export interface BrandMarkProps {
  /** Chip size in px — glyph scales proportionally. Default matches the Sidebar (34). */
  size?: number
  /** 'inverted' renders a white/glass chip with a blue glyph, for use on the brand-blue
   *  hero background. Default 'solid' is the blue-chip/white-glyph Sidebar treatment. */
  variant?: 'solid' | 'inverted'
  className?: string
}

export function BrandMark({ size = 34, variant = 'solid', className }: BrandMarkProps) {
  const iconSize = Math.round(size * 0.588)
  return (
    <div
      className={classNames(styles.mark, variant === 'inverted' && styles.inverted, className)}
      style={{ '--mark-size': typeof size === 'number' ? `${size}px` : size } as React.CSSProperties}
      aria-hidden="true"
    >
      <svg width={iconSize} height={iconSize} viewBox="0 0 36 36" fill="none">
        <polygon points="18,2 32,10 32,26 18,34 4,26 4,10"
          className={styles.strokeMain} strokeWidth="2.2" strokeLinejoin="round" fill="none" />
        <line x1="18" y1="18" x2="18" y2="34" className={styles.strokeMain} strokeWidth="2.2" />
        <line x1="18" y1="18" x2="32" y2="10" className={styles.strokeMain} strokeWidth="2.2" />
        <line x1="18" y1="18" x2="4"  y2="10" className={styles.strokeMain} strokeWidth="2.2" />
        <polygon points="18,7 27,12 18,17 9,12" className={styles.strokeFace} strokeWidth="1.2" />
      </svg>
    </div>
  )
}
