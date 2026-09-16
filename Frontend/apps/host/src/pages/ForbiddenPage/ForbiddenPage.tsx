import { Button } from '@omniconnect/ui'
import { useNavigate } from 'react-router-dom'
import { Icon } from '../../shared/components/Icon/Icon'
import styles from './ForbiddenPage.module.css'

export interface ForbiddenPageProps {
  /** What the user tried to reach, when naming it does not itself leak anything. */
  what?: string
}

/**
 * Shown when the user is signed in but their role does not grant this.
 *
 * Previously every capability denial redirected to /404, whose copy reads "this page doesn't exist,
 * or you don't have access to it" — one message covering two situations with opposite remedies. A
 * user who genuinely lacks a permission needs to be told to ask an administrator, not left wondering
 * whether they mistyped a URL.
 *
 * Note the deliberate asymmetry with a REMOTE APP the user cannot see: that still answers 404,
 * because acknowledging it would confirm the existence of modules they have no business knowing
 * about. This page is for host features, whose existence is not a secret.
 */
export function ForbiddenPage({ what }: ForbiddenPageProps) {
  const navigate = useNavigate()

  return (
    <div className={styles.wrapper}>
      <div className={styles.icon} aria-hidden="true">
        <Icon.Shield width={26} height={26} />
      </div>
      <h1 className={styles.title}>You don&rsquo;t have access to {what ?? 'this page'}</h1>
      <p className={styles.message}>
        Your role doesn&rsquo;t include this permission. An administrator can grant it from Setup &rsaquo; Roles.
      </p>
      <Button variant="secondary" onClick={() => navigate('/')}>
        Back to Dashboard
      </Button>
    </div>
  )
}
