import { useEffect, useState, type ReactNode } from 'react';
import { Button, Modal } from '@omniconnect/ui';
import { isApprovalPending } from '../services/httpClient';
import styles from './ConfirmDialog.module.css';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What is about to happen, in plain words. */
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  /** A change that cannot be undone. Styles the confirm button as destructive. */
  destructive?: boolean;
  /** Runs when confirmed. If it rejects, the dialog stays open and shows why. */
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

/**
 * Asks before doing something that matters, and reports the server's answer instead of hiding it.
 *
 * The server refuses some of these on purpose — a category that still has sub-categories cannot be
 * deleted — and that refusal is the useful part. It is shown here, in the dialog that asked, with the
 * buttons freed so the person can back out. A change that was sent for approval rather than applied is
 * not an error: the dialog simply closes, and the toast already said who has to approve it.
 */
export function ConfirmDialog({ open, title, message, confirmLabel, cancelLabel = 'Cancel', destructive, onConfirm, onClose }: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);

  useEffect(() => {
    if (open) setRefusal(null);
  }, [open]);

  const confirm = async () => {
    setBusy(true);
    setRefusal(null);
    try {
      await onConfirm();
      onClose();
    } catch (error) {
      if (isApprovalPending(error)) onClose();
      else setRefusal((error as Error).message);
    } finally {
      setBusy(false);
    }
  };

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
          <Button variant={destructive ? 'danger' : 'primary'} onClick={confirm} loading={busy} disabled={busy}>
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
  );
}
