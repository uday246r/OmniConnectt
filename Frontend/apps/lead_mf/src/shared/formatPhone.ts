import { EMPTY_VALUE } from '@omniremit/ui'

/**
 * Renders a stored phone number as a single clean Malaysian number.
 *
 * Some lead records were written with the country code already inside `phone` while the create
 * flow also prepends `phoneCountryCode` ('+60'), so the directory showed
 * "+60 +60 19-456 7890" — which then wrapped onto two lines and made every row taller. Collapsing
 * the repeat is a display-side fix; the underlying rows are left alone.
 */
export function formatPhone(raw?: string | null): string {
  const value = (raw ?? '').trim()
  if (!value) return EMPTY_VALUE

  // Collapse any run of repeated leading "+60" (with or without spacing) down to one.
  const deduped = value.replace(/^(?:\+?60[\s-]*)+/i, '+60 ')
  return deduped.replace(/\s{2,}/g, ' ').trim()
}
