import { EMPTY_VALUE } from '@omniremit/ui'

/**
 * Customer360's value formatters.
 *
 * APP-LEVEL SHARED. `formatValue` was defined **four times** — byte-identical — inside
 * CaseDetailsModal, CompanyOverview, ProductDetailsModal and Customer360, and `formatCurrency`
 * twice, differing only in how each sourced the country. All six were declared *inside* the
 * component body, so they were reallocated on every render.
 *
 * The placeholder now comes from `@omniremit/ui`'s `EMPTY_VALUE` (an em dash), which is what the
 * host renders for a missing value. c360 previously used an ASCII hyphen, so identical data read
 * differently depending on which app you were looking at.
 */

/** Normalises CRM's several flavours of "nothing" — null, undefined, "", "null", "undefined". */
export function formatValue(val: unknown): string {
  if (val === null || val === undefined) return EMPTY_VALUE
  const s = String(val).trim()
  if (s === '' || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined') {
    return EMPTY_VALUE
  }
  return s
}

/**
 * Money, with the currency inferred from the profile's country when the value does not already
 * carry one. `country` is passed in because each caller sources it differently (the product modal
 * from its own prop, Customer360 from the corporate profile).
 */
export function formatCurrency(val: unknown, country?: string | null): string {
  const formatted = formatValue(val)
  if (formatted === EMPTY_VALUE) return EMPTY_VALUE
  if (
    formatted.includes('MYR') ||
    formatted.includes('SGD') ||
    formatted.includes('RM') ||
    formatted.includes('$')
  ) {
    return formatted
  }

  const currency = (country ?? '').toUpperCase() === 'SG' ? 'SGD' : 'MYR'
  const cleanVal = formatted.replace(/,/g, '')
  if (cleanVal !== '' && !Number.isNaN(Number(cleanVal))) {
    const formattedNum = parseFloat(cleanVal).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    return `${currency} ${formattedNum}`
  }
  return `${currency} ${formatted}`
}

/**
 * Resolves the status string across diverse CRM product models
 * (CASA, Financing, Card, Takaful/Insurance, Gold).
 */
export function resolveProductStatus(item: unknown): string {
  if (!item || typeof item !== 'object') return ''
  const rec = item as Record<string, unknown>
  const s = String(
    rec.derivedAccountStatus ||
    rec.financingStatus ||
    rec.certStatus ||
    rec.goldStatus ||
    rec.cardStatus ||
    rec.accountStatus ||
    rec.status ||
    ''
  ).trim()
  if (!s || s.toLowerCase() === 'null' || s.toLowerCase() === 'undefined' || s === EMPTY_VALUE) {
    return ''
  }
  return s
}
