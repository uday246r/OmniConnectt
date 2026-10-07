import { useEffect, useState, type ReactNode } from 'react'
import { Button } from '../../primitives/Button/Button'
import { Modal } from '../Modal/Modal'
import styles from './ConfirmDialog.module.css'

export interface ConfirmDialogProps {
  open: boolean
  title: string
  /** What is about to happen, in plain words. */
  message: ReactNode
  confirmLabel: string
  cancelLabel?: string
  /** A change that cannot be undone. Styles the confirm button as destructive. */
  destructive?: boolean
  /** Runs when confirmed. If it rejects, the dialog stays open and shows why. */
  onConfirm: () => Promise<void>
  onClose: () => void
  /**
   * Recognises a rejection that means the change went for approval rather than failing — each
   * service signals that its own way. When it returns true the dialog closes quietly, because the
   * toast has already said who has to approve it. Without it such a rejection would be shown as an
   * error about a change that was in fact accepted.
   */
  pendingApproval?: (error: unknown) => boolean
}

/**
 * Asks before doing something that matters, and reports the server's answer instead of hiding it.
 *
 * The server refuses some of these on purpose — a category that still has sub-categories cannot be
 * deleted — and that refusal is the useful part. It is shown here, in the dialog that asked, with the
 * buttons freed so the person can back out. Promoted from the marketplace, which was the only app
 * handling either case.
 */
export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel = 'Cancel',
  destructive,
  onConfirm,
  onClose,
  pendingApproval,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  useEffect(() => {
    if (open) setRefusal(null)
  }, [open])

  const confirm = async () => {
    setBusy(true)
    setRefusal(null)
    try {
      await onConfirm()
      onClose()
    } catch (error) {
      if (pendingApproval?.(error)) onClose()
      else setRefusal(error instanceof Error ? error.message : String(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open={open}
      title={title}
      onClose={busy ? () => undefined : onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button
            variant={destructive ? 'danger' : 'primary'}
            onClick={confirm}
            loading={busy}
            disabled={busy}
          >
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className={styles.body}>{message}</div>
      {refusal && (
        <p role="alert" className={styles.refusal}>
          {refusal}
        </p>
      )}
    </Modal>
  )
}
