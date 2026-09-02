import type { InputHTMLAttributes } from 'react'
import styles from './Switch.module.css'

export type SwitchProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>

export function Switch({ className, ...rest }: SwitchProps) {
  return (
    <span className={[styles.switch, className].filter(Boolean).join(' ')}>
      <input type="checkbox" role="switch" className={styles.input} {...rest} />
      <span className={styles.track} aria-hidden="true" />
    </span>
  )
}
