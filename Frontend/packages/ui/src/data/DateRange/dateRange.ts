/*
 * One date-range vocabulary for every log screen on the platform.
 *
 * There were three implementations of this before, and they disagreed. The host's Audit Logs
 * anchored a custom range to LOCAL time with a time-of-day component; System Logs anchored to local
 * time but had no reachable time control at all; the Approval Center anchored to UTC. So "12 Sep"
 * selected three different windows depending on which screen you typed it into, and the remotes
 * offered no date filter whatsoever. Three of those were defensible in isolation and the set of them
 * was not.
 *
 * THE TIMEZONE DECISION, and why it is local.
 *
 * Every stored column is already an absolute instant, and every bound on the wire is an ISO 8601
 * instant, so the server never guesses — this decision reaches only as far as how the browser reads
 * what an operator typed. It is local because every one of these tables renders its timestamps in
 * the viewer's own zone: if "Today" meant the UTC day, an operator at UTC+8 would ask for today and
 * be shown rows stamped yesterday evening. A filter has to select what the eye reads.
 *
 * The Approval Center's UTC anchoring is therefore the one behaviour that changes. At UTC+8, "12
 * Sep" there used to mean 08:00 on the 12th through 07:59 on the 13th, local; it now means midnight
 * to midnight, local, like everywhere else.
 */

export type DateRangePreset = 'all' | 'today' | 'yesterday' | 'week' | 'month' | 'custom'

/**
 * What a screen holds in state — a preset, not a pair of instants.
 *
 * Storing the resolved instants instead would freeze them: a page left open overnight with "Today"
 * selected would keep filtering to yesterday, and a saved or shared filter would mean something
 * different tomorrow than it did when it was written.
 */
export interface DateRangeValue {
  preset: DateRangePreset
  /** `YYYY-MM-DD`. Only meaningful when the preset is `custom`. */
  fromDate?: string
  /** `HH:mm`. Empty means the start of that day. */
  fromTime?: string
  toDate?: string
  /** `HH:mm`. Empty means the end of that day. */
  toTime?: string
}

/** What goes on the wire: ISO 8601 instants, or nothing at all for `all`. */
export interface DateRangeInstants {
  from?: string
  to?: string
}

export const EMPTY_DATE_RANGE: DateRangeValue = { preset: 'all' }

export const DATE_RANGE_PRESETS: { key: DateRangePreset; label: string }[] = [
  { key: 'all', label: 'All Time' },
  { key: 'today', label: 'Today' },
  { key: 'yesterday', label: 'Yesterday' },
  { key: 'week', label: 'Last 7 Days' },
  { key: 'month', label: 'Last 30 Days' },
  { key: 'custom', label: 'Custom' },
]

function startOfDay(date: Date): Date {
  const start = new Date(date)
  start.setHours(0, 0, 0, 0)
  return start
}

/**
 * The last representable instant of a day, to a millisecond.
 *
 * Every one of the platform's audit queries compares its upper bound INCLUSIVELY (`<=`), which is
 * what an operator typing "to 17:00" expects — a row stamped exactly 17:00:00 is in the range they
 * asked for. The cost is that a row falling in the sub-millisecond remainder of the final day is
 * excluded, since Postgres stores microseconds and this only reaches milliseconds.
 *
 * That is a real gap and a deliberate one. Closing it means an exclusive upper bound, which in turn
 * means a typed "to 17:00" excludes 17:00:00 exactly — surprising in the case operators actually
 * type, to fix a case that is unobservable. The inclusive reading is the one that matches what the
 * control says it does.
 */
function endOfDay(date: Date): Date {
  const end = new Date(date)
  end.setHours(23, 59, 59, 999)
  return end
}

function combine(date: string, time: string, fallbackToEndOfDay: boolean): Date | null {
  if (!date) return null
  // Parsed without a Z and without an offset, so the browser reads it in the local zone — which is
  // the whole point. Appending seconds keeps Safari from rejecting the shorter form.
  const parsed = new Date(`${date}T${time || '00:00'}:00`)
  if (Number.isNaN(parsed.getTime())) return null
  if (!time && fallbackToEndOfDay) return endOfDay(parsed)
  return parsed
}

/**
 * Turns the editable value into the instants a request carries.
 *
 * @param now Injectable so a test can pin the clock without touching global time.
 */
export function resolveDateRange(value: DateRangeValue, now: Date = new Date()): DateRangeInstants {
  if (value.preset === 'custom') {
    const from = combine(value.fromDate ?? '', value.fromTime ?? '', false)
    const to = combine(value.toDate ?? '', value.toTime ?? '', true)
    return {
      from: from?.toISOString(),
      to: to?.toISOString(),
    }
  }

  const today = startOfDay(now)

  switch (value.preset) {
    case 'today':
      return { from: today.toISOString(), to: endOfDay(now).toISOString() }

    case 'yesterday': {
      const yesterday = new Date(today)
      yesterday.setDate(yesterday.getDate() - 1)
      return { from: yesterday.toISOString(), to: endOfDay(yesterday).toISOString() }
    }

    /*
     * Calendar days, inclusive of today — seven distinct dates for "Last 7 Days", not a rolling
     * 168 hours from this instant. The rolling form shifted under a page left open, and did not
     * match what the label says: an operator asking for the last seven days means seven dates.
     */
    case 'week': {
      const start = new Date(today)
      start.setDate(start.getDate() - 6)
      return { from: start.toISOString(), to: endOfDay(now).toISOString() }
    }

    case 'month': {
      const start = new Date(today)
      start.setDate(start.getDate() - 29)
      return { from: start.toISOString(), to: endOfDay(now).toISOString() }
    }

    default:
      return {}
  }
}

/** Whether this range narrows anything — drives the "filter is active" dot on the trigger. */
export function isDateRangeActive(value: DateRangeValue): boolean {
  if (value.preset === 'all') return false
  if (value.preset !== 'custom') return true
  return Boolean(value.fromDate || value.toDate)
}

/** `Last 7 Days`, or `12 Sep 09:00 → 13 Sep 17:30` — for the filter chip and the popover header. */
export function describeDateRange(value: DateRangeValue): string {
  if (value.preset !== 'custom') {
    return DATE_RANGE_PRESETS.find((p) => p.key === value.preset)?.label ?? 'All Time'
  }

  const from = value.fromDate ? `${value.fromDate}${value.fromTime ? ` ${value.fromTime}` : ''}` : '…'
  const to = value.toDate ? `${value.toDate}${value.toTime ? ` ${value.toTime}` : ''}` : '…'
  return `${from} → ${to}`
}

/**
 * Round-trips a range through a URL-safe string, for a screen that wants its filter shareable.
 *
 * The preset is preserved rather than the instants it resolves to, so a link to "Last 7 Days" still
 * means the last seven days when it is opened next week.
 */
export function serializeDateRange(value: DateRangeValue): string {
  if (value.preset !== 'custom') return value.preset
  return ['custom', value.fromDate ?? '', value.fromTime ?? '', value.toDate ?? '', value.toTime ?? ''].join('|')
}

export function parseDateRange(raw: string | null | undefined): DateRangeValue {
  if (!raw) return EMPTY_DATE_RANGE

  const [preset, fromDate, fromTime, toDate, toTime] = raw.split('|')
  if (preset !== 'custom') {
    const known = DATE_RANGE_PRESETS.some((p) => p.key === preset)
    return known ? { preset: preset as DateRangePreset } : EMPTY_DATE_RANGE
  }

  return {
    preset: 'custom',
    fromDate: fromDate || undefined,
    fromTime: fromTime || undefined,
    toDate: toDate || undefined,
    toTime: toTime || undefined,
  }
}
