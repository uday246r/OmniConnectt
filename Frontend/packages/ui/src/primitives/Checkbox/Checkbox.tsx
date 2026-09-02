import type { InputHTMLAttributes, ReactNode } from 'react'
import { classNames } from '../../utils/classNames'
import styles from './Checkbox.module.css'

export interface CheckboxProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> {
  label?: ReactNode
  wrapperClassName?: string
}

export function Checkbox({ label, wrapperClassName, ...rest }: CheckboxProps) {
  return (
    <label className={classNames(styles.label, wrapperClassName)}>
      <input type="checkbox" className={styles.input} {...rest} />
      <span className={styles.box} aria-hidden="true">
        <span className={styles.check}>✓</span>
      </span>
      {label}
    </label>
  )
}
