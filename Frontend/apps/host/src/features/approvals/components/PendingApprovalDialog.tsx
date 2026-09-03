import { useNavigate } from 'react-router-dom'
import type { PendingApprovalConflict } from '../pendingConflict'
import styles from './PendingApprovalDialog.module.css'
import { Button, Modal } from '@omniremit/ui'

function formatWhen(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso

  const diffMin = Math.floor((Date.now() - date.getTime()) / 60_000)
  const absolute = date.toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  })

  if (diffMin < 1) return `just now (${absolute})`
  if (diffMin < 60) return `${diffMin} minute${diffMin === 1 ? '' : 's'} ago (${absolute})`
  const diffHr = Math.floor(diffMin / 60)
  if (diffHr < 24) return `${diffHr} hour${diffHr === 1 ? '' : 's'} ago (${absolute})`
  return absolute
}

export interface PendingApprovalDialogProps {
  conflict: PendingApprovalConflict | null
  onClose: () => void
}

/**
 * Shown when a gated action is refused because the target record already has a request awaiting
 * approval.
 *
 * This is deliberately a dialog rather than an error toast. The user has done nothing wrong — the
 * change they want is already in flight — and the useful information (what is pending, who raised
 * it, who has to act on it) does not fit in a toast, nor does it belong in something that
 * auto-dismisses before it is read. It's the same reason banking consoles surface this as a blocking
 * notice: silently doing nothing, or flashing a red error, both leave the operator clicking again.
 */
export function PendingApprovalDialog({ conflict, onClose }: PendingApprovalDialogProps) {
  const navigate = useNavigate()

  if (!conflict) return null

  const target = conflict.entityLabel ? `“${conflict.entityLabel}”` : `this ${conflict.module.toLowerCase()} record`
  const raisedBy = conflict.isOwnRequest ? 'You' : conflict.makerName ?? 'Another user'

  return (
    <Modal
      open
      title="Already awaiting approval"
      onClose={onClose}
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              onClose()
              // The maker can watch their own request from My Requests; anyone else needs the
              // Approval Center, which is also where a checker would go to act on it.
              navigate(conflict.isOwnRequest ? '/my-requests' : '/system/approvals')
            }}
          >
            {conflict.isOwnRequest ? 'View my requests' : 'Open Approval Center'}
          </Button>
        </>
      }
    >
      <p className={styles.lead}>
        {raisedBy} {conflict.isOwnRequest ? 'have' : 'has'} already requested a{' '}
        <strong>{conflict.action.toLowerCase()}</strong> on {target}, and it hasn&rsquo;t been decided yet.
      </p>

      <dl className={styles.detailList}>
        <dt>Requested</dt>
        <dd>{formatWhen(conflict.requestedAt)}</dd>

        <dt>Waiting on</dt>
        <dd>{conflict.checkerName ?? 'an assigned checker'}</dd>
      </dl>

      <p className={styles.footnote}>
        Only one change can be in flight per record, so nothing was submitted. Once the request above
        is approved or rejected, you can make a new one.
      </p>
    </Modal>
  )
}
