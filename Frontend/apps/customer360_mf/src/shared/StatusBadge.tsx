import { Badge, type BadgeTone } from '@omniremit/ui'
import { formatValue } from './formatValue'

/**
 * A product/account status rendered as the platform Badge.
 *
 * APP-LEVEL SHARED, not global: the *mapping* below is Customer360's own domain vocabulary
 * ("Validated", "WIP", derived account statuses from CRM), so it does not belong in
 * `@omniremit/ui`. The *chrome* is entirely the shared `Badge` — this component owns no colours,
 * no padding and no radius of its own, which is what keeps c360's statuses identical to the
 * host's.
 *
 * Replaces 11 hand-written copies of
 *   `status-badge ${x.toLowerCase().includes('active') ? 'status-active' : 'status-validated'}`
 * spread across ProductDetailsModal and Customer360, each of which re-derived the same rule.
 */

/** CRM returns free-text statuses; this is the single place that decides what each one looks like. */
export function statusTone(status: string | null | undefined): BadgeTone {
  const s = (status ?? '').toLowerCase()
  if (!s) return 'neutral'
  if (s.includes('active') || s.includes('confirm') || s.includes('approved') || s.includes('success')) return 'success'
  if (s.includes('pending') || s.includes('progress') || s.includes('wip') || s.includes('review')) return 'warning'
  if (s.includes('closed') || s.includes('reject') || s.includes('fail') || s.includes('overdue')) return 'danger'
  if (s.includes('new') || s.includes('open')) return 'info'
  return 'neutral'
}

export interface StatusBadgeProps {
  status: string | null | undefined
  /** Show the leading dot. Off by default — matches how c360's product fields rendered before. */
  dot?: boolean
  /** Override the derived tone when the caller already knows the semantic outcome. */
  tone?: BadgeTone
}

export function StatusBadge({ status, dot, tone }: StatusBadgeProps) {
  return (
    <Badge tone={tone ?? statusTone(status)} dot={dot}>
      {formatValue(status)}
    </Badge>
  )
}
