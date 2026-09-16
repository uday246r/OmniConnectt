import { Badge, type BadgeTone, EMPTY_VALUE } from '@omniconnect/ui'
import { formatValue } from './formatValue'

/**
 * A product/account status rendered as the platform Badge.
 *
 * APP-LEVEL SHARED, not global: the *mapping* below is Customer360's own domain vocabulary
 * ("Validated", "WIP", derived account statuses from CRM), so it does not belong in
 * `@omniconnect/ui`. The *chrome* is entirely the shared `Badge` — this component owns no colours,
 * no padding and no radius of its own, which is what keeps c360's statuses identical to the
 * host's.
 */

/** CRM returns free-text statuses; this is the single place that decides what each one looks like. */
export function statusTone(status: string | null | undefined): BadgeTone {
  const s = (status ?? '').toLowerCase().trim()
  if (!s) return 'neutral'
  if (
    s.includes('active') ||
    s.includes('confirm') ||
    s.includes('approved') ||
    s.includes('success') ||
    s.includes('in force') ||
    s.includes('in-force') ||
    s.includes('enforced')
  ) {
    return 'success'
  }
  if (
    s.includes('pending') ||
    s.includes('progress') ||
    s.includes('wip') ||
    s.includes('review') ||
    s.includes('dormant') ||
    s.includes('underwriting')
  ) {
    return 'warning'
  }
  if (
    s.includes('closed') ||
    s.includes('reject') ||
    s.includes('fail') ||
    s.includes('overdue') ||
    s.includes('lapsed') ||
    s.includes('terminated')
  ) {
    return 'danger'
  }
  if (s.includes('new') || s.includes('open') || s.includes('mature')) {
    return 'info'
  }
  return 'neutral'
}

export interface StatusBadgeProps {
  status: string | null | undefined
  /** Show the leading dot. On by default — matches how AuditLogs and host badges render. */
  dot?: boolean
  /** Override the derived tone when the caller already knows the semantic outcome. */
  tone?: BadgeTone
}

export function StatusBadge({ status, dot = true, tone }: StatusBadgeProps) {
  const formatted = formatValue(status)
  if (
    !status ||
    formatted === EMPTY_VALUE ||
    formatted.trim() === '' ||
    formatted.toLowerCase() === 'null' ||
    formatted.toLowerCase() === 'undefined'
  ) {
    return (
      <span style={{ color: 'var(--omni-color-text-muted, #94a3b8)', fontWeight: 'normal' }}>
        {EMPTY_VALUE}
      </span>
    )
  }
  return (
    <Badge tone={tone ?? statusTone(status)} dot={dot}>
      {formatted}
    </Badge>
  )
}
