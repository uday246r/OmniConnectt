import { Button } from '@omniremit/ui'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../shared/components/Icon/Icon'
import styles from './LockedPage.module.css'

export interface LockedPageProps {
  appDisplayName: string
  /** The operator-authored explanation from the licensing screen, shown verbatim. */
  reason?: string | null
}

/**
 * Shown instead of loading a remote that this deployment is not licensed for.
 *
 * Kept distinct from Forbidden on purpose. "Your plan does not include this" and "your role does not
 * allow this" need entirely different responses — one is a conversation with sales, the other with an
 * administrator — and collapsing both into a 404, which is what happened before, sent every user down
 * the wrong path.
 */
export function LockedPage({ appDisplayName, reason }: LockedPageProps) {
  const navigate = useNavigate()

  return (
    <div className={styles.wrapper}>
      <div className={styles.icon} aria-hidden="true">
        <Icon.Lock width={26} height={26} />
      </div>
      <h1 className={styles.title}>{appDisplayName} is not included in your plan</h1>
      <p className={styles.message}>
        {reason?.trim() || 'Contact your account administrator to add this module to your subscription.'}
      </p>
      <Button variant="secondary" onClick={() => navigate('/')}>
        Back to Dashboard
      </Button>
    </div>
  )
}
