import type { ButtonHTMLAttributes, ReactNode } from 'react'
import { classNames } from '../../utils/classNames'
import styles from './Button.module.css'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'onHeader'
export type ButtonSize = 'sm' | 'md' | 'lg'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  fullWidth?: boolean
  loading?: boolean
  leadingIcon?: ReactNode
}

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth,
  loading,
  leadingIcon,
  disabled,
  children,
  className,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={classNames(styles.button, styles[variant], styles[size], fullWidth && styles.fullWidth, className)}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <span className={styles.spinner} aria-hidden="true" /> : leadingIcon}
      {children}
    </button>
  )
}
