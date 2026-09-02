import { Badge, type BadgeTone } from '@omniremit/ui'

/**
 * A lead's pipeline status, rendered as the platform Badge.
 *
 * APP-LEVEL SHARED. `getStatusBadge` existed **twice** — in RecentLeadsCard and LeadDetailsDrawer —
 * and the two copies DISAGREED, so the same lead looked different depending on the screen:
 *
 *   Converted  dashboard #d1fae5/#065f46   drawer #ecfdf5/#047857
 *   Rejected   dashboard #fee2e2/#991b1b   drawer #fff1f2/#be185d  (red vs pink)
 *   Contacted  dashboard — no case at all, so it fell through to blue "New"
 *              drawer    #ede9fe/#6d28d9   (purple)
 *
 * That last one was a genuine bug, not only a styling inconsistency: a contacted lead reported
 * itself as "New" on the dashboard. One mapping now serves both, and the colours come from the
 * platform's badge tones rather than fifteen hardcoded hexes, so a lead status looks the same here
 * as an equivalent status does in the host.
 */
export function leadStatusTone(status?: string | null): BadgeTone {
  const s = (status ?? '').toLowerCase()
  if (s.includes('convert')) return 'success'
  if (s.includes('progress')) return 'warning'
  if (s.includes('reject') || s.includes('cancel')) return 'danger'
  if (s.includes('qualif') || s.includes('contact')) return 'info'
  return 'primary'
}

/** The display label, preserving the server's own wording when it sends one. */
export function leadStatusLabel(status?: string | null): string {
  if (status) return status
  return 'New'
}

export interface LeadStatusBadgeProps {
  status?: string | null
  /** Show the leading dot. The drawer and the dashboard card both did; list rows did not. */
  dot?: boolean
}

export function LeadStatusBadge({ status, dot = true }: LeadStatusBadgeProps) {
  return (
    <Badge tone={leadStatusTone(status)} dot={dot}>
      {leadStatusLabel(status)}
    </Badge>
  )
}
