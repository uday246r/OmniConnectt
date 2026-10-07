import { Icon } from '../../shared/components/Icon/Icon'
import styles from './NoAccessPage.module.css'

/**
 * What a signed-in account with nothing assigned to it sees.
 *
 * This is the one case a redirect cannot help: the user has no dashboard, no module and no settings
 * section, so there is nowhere to send them. It used to render the 404 page, which told them the
 * platform was broken when their account is merely empty — and left them with no idea what to do.
 *
 * Reached only from DashboardRoute's last fallback, after the navigation tree has arrived and proved
 * to hold nothing this caller can open.
 */
export function NoAccessPage() {
  return (
    <div className={styles.wrapper}>
      <div className={styles.icon} aria-hidden="true">
        <Icon.ShieldCheck width={28} height={28} />
      </div>
      <h1 className={styles.title}>Nothing is assigned to your account yet</h1>
      <p className={styles.message}>
        You are signed in, but no applications or settings have been granted to you. Ask an
        administrator to assign you a role, then sign out and back in.
      </p>
    </div>
  )
}
