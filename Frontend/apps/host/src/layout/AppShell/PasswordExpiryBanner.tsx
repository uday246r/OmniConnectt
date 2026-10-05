import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useAuthStore } from '../../features/auth/store/authStore'
import { Icon } from '../../shared/components/Icon/Icon'
import styles from './PasswordExpiryBanner.module.css'

const storageKey = (userId: string, daysRemaining: number) => `omni_pw_expiry_dismissed:${userId}:${daysRemaining}`

function wasDismissed(key: string): boolean {
  try {
    return sessionStorage.getItem(key) === '1'
  } catch {
    return false // storage blocked — show the banner rather than lose the warning
  }
}

/**
 * "Your password expires in N days." Shown only when the server says so (`passwordExpiry.showReminder`),
 * which already accounts for the administrator's channel choice and the warning window — the client holds
 * no policy of its own to disagree with.
 *
 * Dismissal lasts for the browser session AND for that day count: it is keyed on `daysRemaining`, so a
 * banner closed at "5 days" stays closed until tomorrow, when it comes back as "4 days". A warning that
 * can be silenced for good stops being one.
 */
export function PasswordExpiryBanner() {
  const userId = useAuthStore((s) => s.user?.id)
  const expiry = useAuthStore((s) => s.user?.passwordExpiry)
  const [dismissedKey, setDismissedKey] = useState<string | null>(null)

  if (!userId || !expiry?.showReminder || expiry.isExpired || expiry.daysRemaining == null) return null

  const key = storageKey(userId, expiry.daysRemaining)
  if (dismissedKey === key || wasDismissed(key)) return null

  const days = expiry.daysRemaining
  const when = days <= 1 ? 'tomorrow' : `in ${days} days`

  function dismiss() {
    try {
      sessionStorage.setItem(key, '1')
    } catch {
      /* storage blocked — the in-memory state below still hides it for this page load */
    }
    setDismissedKey(key)
  }

  return (
    <div className={styles.banner} role="status">
      <Icon.Clock width={16} height={16} className={styles.icon} />
      <span className={styles.text}>
        Your password expires <strong>{when}</strong>. Change it now to avoid being locked out.
      </span>
      <Link to="/profile" className={styles.action}>Change password</Link>
      <button type="button" className={styles.close} onClick={dismiss} aria-label="Dismiss password expiry reminder">
        <Icon.X width={14} height={14} />
      </button>
    </div>
  )
}
