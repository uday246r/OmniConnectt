import type { ReactNode } from 'react'
import { useEffect } from 'react'
import styles from './Modal.module.css'

export interface ModalProps {
  open: boolean
  title: string
  children?: ReactNode
  onClose: () => void
  actions?: ReactNode
  size?: 'sm' | 'md' | 'lg' | 'xl'
  className?: string
}

export function Modal({ open, title, children, onClose, actions, size = 'sm', className }: ModalProps) {
  useEffect(() => {
    if (!open) return
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  const sizeClass =
    size === 'xl' ? styles.dialogXl : size === 'lg' ? styles.dialogLg : size === 'md' ? styles.dialogMd : styles.dialogSm

  return (
    <div className={styles.overlay} onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`${styles.dialog} ${sizeClass} ${className ?? ''}`} role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <h2 id="modal-title" className={styles.title}>
          {title}
        </h2>
        {children && <div className={styles.body}>{children}</div>}
        {actions && <div className={styles.actions}>{actions}</div>}
      </div>
    </div>
  )
}
