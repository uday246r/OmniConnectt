/*
 * One date/time presentation for the whole platform.
 *
 * There were 23 independent `toLocaleDateString` / `toLocaleString` / `toLocaleTimeString` call
 * sites across the host and the two remotes (13 / 6 / 4), each choosing its own options, so the same
 * timestamp rendered differently depending on which screen you were looking at. These are the
 * canonical formatters.
 *
 * All of them accept the shapes the APIs actually return — an ISO string from .NET's
 * DateTimeOffset serialization, a Date, or null/undefined for an absent value — and never throw on
 * bad input. A malformed timestamp renders as the em-dash placeholder rather than "Invalid Date",
 * which is what several call sites were doing.
 */

/** What every formatter renders for a null, undefined or unparseable value. */
export const EMPTY_VALUE = '—'

function toDate(value: string | number | Date | null | undefined): Date | null {
  if (value === null || value === undefined || value === '') return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** `12 Mar 2026` — the platform's standard date-only presentation. */
export function formatDate(value: string | number | Date | null | undefined): string {
  const date = toDate(value)
  if (!date) return EMPTY_VALUE
  return date.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

/** `12 Mar 2026, 14:05` — date plus 24-hour time, for audit trails and approval timelines. */
export function formatDateTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value)
  if (!date) return EMPTY_VALUE
  return `${formatDate(date)}, ${date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  })}`
}

/** `14:05` — time only, for grouping rows already under a date heading. */
export function formatTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value)
  if (!date) return EMPTY_VALUE
  return date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', hour12: false })
}

/**
 * `just now` / `5m ago` / `3h ago` / `2d ago`, falling back to an absolute date past a week.
 *
 * Used for "last checked" style captions where recency matters more than the exact moment. Past a
 * week the relative form stops being useful ("53d ago" tells you less than a date does), so it
 * hands off to formatDate.
 */
export function formatRelativeTime(value: string | number | Date | null | undefined): string {
  const date = toDate(value)
  if (!date) return EMPTY_VALUE

  const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
  // A clock skew between server and browser can make a timestamp look slightly future-dated; that
  // is not worth surfacing as "in -3 seconds".
  if (seconds < 60) return 'just now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`
  if (seconds < 86_400) return `${Math.floor(seconds / 3600)}h ago`
  if (seconds < 604_800) return `${Math.floor(seconds / 86_400)}d ago`
  return formatDate(date)
}

/**
 * `Sep 2, 2026, 09:03 AM` — the platform's audit-trail timestamp.
 *
 * Byte-for-byte the host's Audit Logs format, which is the reference. The three audit tables had
 * three different formats:
 *
 *   host              Sep 2, 2026, 09:03 AM      (no seconds)
 *   lead_mf           Sep 02, 2026, 03:46:34 AM  (2-digit day, plus seconds)
 *   customer360_mf    Sep 2, 2026, 09:03:50 AM   (seconds)
 *
 * Seconds are deliberately absent: an audit table is read by scanning a column of times, and the
 * extra field widens every row for precision nobody scans for. The exact instant is still on the
 * record, and each app's detail drawer can show it in full.
 *
 * Locale is pinned to en-US rather than the viewer's, because the surrounding audit copy is en-US
 * and a mixed-locale row reads as a bug.
 */
export function formatAuditTimestamp(value: string | number | Date | null | undefined): string {
  const date = toDate(value)
  if (!date) return EMPTY_VALUE
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
