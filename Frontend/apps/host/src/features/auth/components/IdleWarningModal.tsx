import styles from './IdleWarningModal.module.css'
import { Button, Modal } from '@omniremit/ui'

export interface IdleWarningModalProps {
  open: boolean
  secondsRemaining: number
  onStaySignedIn: () => void
  onSignOut: () => void
}

/**
 * Countdown shown before an idle session is ended.
 *
 * The remaining time is announced via aria-live so a screen-reader user is not silently signed out —
 * but as `polite` with a per-second update the assertive alternative would spam. The message carries
 * the number so the announcement is meaningful on its own.
 */
export function IdleWarningModal({ open, secondsRemaining, onStaySignedIn, onSignOut }: IdleWarningModalProps) {
  return (
    <Modal open={open} title="Still there?" onClose={onStaySignedIn}>
      <div className={styles.body}>
        <p className={styles.message} aria-live="polite">
          You&rsquo;ve been inactive for a while. For security, you&rsquo;ll be signed out in{' '}
          <strong className={styles.count}>{secondsRemaining}</strong> second
          {secondsRemaining === 1 ? '' : 's'}.
        </p>
        <div className={styles.actions}>
          <Button variant="ghost" onClick={onSignOut}>
            Sign out now
          </Button>
          <Button onClick={onStaySignedIn}>Stay signed in</Button>
        </div>
      </div>
    </Modal>
  )
}
