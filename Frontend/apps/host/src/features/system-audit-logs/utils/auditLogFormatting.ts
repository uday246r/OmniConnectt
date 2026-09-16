// Raw actions arrive as backend event names ("auth.login_succeeded", "remoteapp.deleted") — accurate
// for logs, unreadable for the person reviewing them. Known actions get an exact, hand-written label;
// anything not in the map yet still gets turned into words instead of showing raw dot/underscore
// notation, so a new action type added later degrades gracefully rather than looking broken.
const ACTION_LABELS: Record<string, string> = {
  'auth.login_succeeded': 'Login Succeeded',
  'auth.login_failed': 'Login Failed',
  'page.viewed': 'Opened Page',
  'details.viewed': 'Viewed Details',
  'system_log.details_viewed': 'Viewed System Log Details',
  'audit_log.details_viewed': 'Viewed Audit Log Details',
  'lead.details_viewed': 'Viewed Lead Details',
  'customer.details_viewed': 'Viewed Customer Details',
  'remoteapp.created': 'Remote App Registered',
  'remoteapp.updated': 'Remote App Updated',
  'remoteapp.deleted': 'Remote App Removed',
  'remoteapp.status_changed': 'Remote App Status Changed',
  'employee.created': 'Employee Created',
  'employee.updated': 'Employee Updated',
  'employee.deleted': 'Employee Deleted',
  'lead.created': 'Lead Created',
  'lead.updated': 'Lead Updated',
  'lead.deleted': 'Lead Deleted',
}

export function formatActionLabel(action: string): string {
  if (!action) return 'Unknown Action'
  const known = ACTION_LABELS[action]
  if (known) return known
  const segment = action.includes('.') ? action.slice(action.lastIndexOf('.') + 1) : action
  return segment
    .replace(/_/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

/** Maps a raw backend action key to one of the actionCell colour-variant CSS classes. */
export function actionChipClass(action: string): 'actionSuccess' | 'actionDanger' | 'actionWarning' | 'actionLogin' | 'actionNeutral' {
  const a = action.toLowerCase()
  if (a.includes('login_succeeded') || a.includes('login_success')) return 'actionSuccess'
  if (a.includes('login_failed') || a.includes('login_fail')) return 'actionDanger'
  if (a.includes('created') || a.includes('registered')) return 'actionSuccess'
  if (a.includes('deleted') || a.includes('removed') || a.includes('unregistered')) return 'actionDanger'
  if (a.includes('status_changed') || a.includes('maintenance')) return 'actionWarning'
  if (a.includes('updated') || a.includes('changed') || a.includes('modified') || a.includes('details') || a.includes('view')) return 'actionLogin'
  return 'actionNeutral'
}

/** Same mapping as {@link actionChipClass}, expressed as a `Badge` tone for pages that render via `@omniremit/ui`'s `Badge` instead of the Audit Logs page's own CSS classes. */
export function actionBadgeTone(action: string): 'success' | 'danger' | 'warning' | 'info' | 'neutral' {
  const cls = actionChipClass(action)
  if (cls === 'actionSuccess') return 'success'
  if (cls === 'actionDanger') return 'danger'
  if (cls === 'actionWarning') return 'warning'
  if (cls === 'actionLogin') return 'info'
  return 'neutral'
}

export function formatIpv4(ip?: string | null): string {
  if (!ip) return '—'
  let trimmed = ip.trim()
  if (trimmed === '::1' || trimmed === 'localhost') {
    return '127.0.0.1'
  }
  if (trimmed.startsWith('::ffff:')) {
    trimmed = trimmed.substring(7)
  }
  if (trimmed === '::') {
    return '127.0.0.1'
  }
  return trimmed
}
