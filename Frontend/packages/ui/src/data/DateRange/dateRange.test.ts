import { describe, expect, it } from 'vitest'
import {
  DATE_RANGE_PRESETS,
  EMPTY_DATE_RANGE,
  describeDateRange,
  isDateRangeActive,
  parseDateRange,
  resolveDateRange,
  serializeDateRange,
  type DateRangeValue,
} from './dateRange'

/*
 * The date range is now one implementation shared by six screens, replacing three that disagreed
 * about what a range means. These tests pin the resolution rules, because the disagreements they
 * replaced were all invisible: every one of the old implementations produced a plausible window,
 * just not the same one, and nothing anywhere compared them.
 *
 * `now` is injected rather than mocked. A clock these tests control is simpler to read than
 * vi.setSystemTime, and it keeps the local-timezone behaviour honest — these assertions have to
 * hold in whatever zone CI happens to run in, so they are written against local-day boundaries
 * rather than against literal UTC strings.
 */

/** Noon on a Thursday, so day arithmetic never lands ambiguously on a boundary. */
const NOW = new Date(2026, 8, 17, 12, 30, 0)

function localStartOfDay(daysAgo = 0): Date {
  const d = new Date(NOW)
  d.setDate(d.getDate() - daysAgo)
  d.setHours(0, 0, 0, 0)
  return d
}

function localEndOfDay(daysAgo = 0): Date {
  const d = new Date(NOW)
  d.setDate(d.getDate() - daysAgo)
  d.setHours(23, 59, 59, 999)
  return d
}

describe('resolveDateRange', () => {
  it('resolves "all" to no bounds at all rather than to a very wide one', () => {
    expect(resolveDateRange({ preset: 'all' }, NOW)).toEqual({})
  })

  it('resolves "today" to the local day, not the UTC day', () => {
    const { from, to } = resolveDateRange({ preset: 'today' }, NOW)

    expect(from).toBe(localStartOfDay().toISOString())
    expect(to).toBe(localEndOfDay().toISOString())
  })

  it('resolves "yesterday" to a closed day that excludes today', () => {
    const { from, to } = resolveDateRange({ preset: 'yesterday' }, NOW)

    expect(from).toBe(localStartOfDay(1).toISOString())
    expect(to).toBe(localEndOfDay(1).toISOString())
  })

  /*
   * Seven calendar dates including today — not 168 rolling hours from this instant, which is what
   * two of the three previous implementations did. The rolling form quietly shifted under a page
   * left open, and did not match what the label promises.
   */
  it('resolves "last 7 days" to seven calendar days including today', () => {
    const { from, to } = resolveDateRange({ preset: 'week' }, NOW)

    expect(from).toBe(localStartOfDay(6).toISOString())
    expect(to).toBe(localEndOfDay().toISOString())
  })

  it('resolves "last 30 days" to thirty calendar days including today', () => {
    expect(resolveDateRange({ preset: 'month' }, NOW).from).toBe(localStartOfDay(29).toISOString())
  })

  /*
   * The regression guard for the Approval Center, which anchored a custom range to UTC while the
   * other screens anchored to local. At any non-zero offset the two select different rows from the
   * same typed input.
   */
  it('reads a custom time as local, not as UTC', () => {
    const { from } = resolveDateRange(
      { preset: 'custom', fromDate: '2026-09-12', fromTime: '09:00' },
      NOW,
    )

    expect(from).toBe(new Date(2026, 8, 12, 9, 0, 0).toISOString())
    // The naive UTC reading, which is what the old Approval Center produced.
    expect(from).not.toBe('2026-09-12T09:00:00.000Z')
  })

  it('treats a custom range with no times as whole days', () => {
    const { from, to } = resolveDateRange(
      { preset: 'custom', fromDate: '2026-09-12', toDate: '2026-09-13' },
      NOW,
    )

    expect(from).toBe(new Date(2026, 8, 12, 0, 0, 0, 0).toISOString())
    expect(to).toBe(new Date(2026, 8, 13, 23, 59, 59, 999).toISOString())
  })

  it('accepts a half-open custom range', () => {
    expect(resolveDateRange({ preset: 'custom', fromDate: '2026-09-12' }, NOW).to).toBeUndefined()
    expect(resolveDateRange({ preset: 'custom', toDate: '2026-09-12' }, NOW).from).toBeUndefined()
  })

  it('ignores an unparseable custom date rather than sending a bad bound', () => {
    expect(resolveDateRange({ preset: 'custom', fromDate: 'not-a-date' }, NOW).from).toBeUndefined()
  })
})

describe('isDateRangeActive', () => {
  it('is inactive for "all" and for a custom range with nothing filled in', () => {
    expect(isDateRangeActive(EMPTY_DATE_RANGE)).toBe(false)
    expect(isDateRangeActive({ preset: 'custom' })).toBe(false)
  })

  it('is active for any preset and for a partially filled custom range', () => {
    expect(isDateRangeActive({ preset: 'today' })).toBe(true)
    expect(isDateRangeActive({ preset: 'custom', fromDate: '2026-09-12' })).toBe(true)
  })
})

describe('describeDateRange', () => {
  it('names a preset by its label', () => {
    expect(describeDateRange({ preset: 'week' })).toBe('Last 7 Days')
  })

  it('shows both ends of a custom range, and an ellipsis for a missing one', () => {
    expect(
      describeDateRange({ preset: 'custom', fromDate: '2026-09-12', fromTime: '09:00', toDate: '2026-09-13' }),
    ).toBe('2026-09-12 09:00 → 2026-09-13')

    expect(describeDateRange({ preset: 'custom', toDate: '2026-09-13' })).toBe('… → 2026-09-13')
  })
})

describe('serializeDateRange / parseDateRange', () => {
  it.each(DATE_RANGE_PRESETS.filter((p) => p.key !== 'custom').map((p) => p.key))(
    'round-trips the "%s" preset',
    (preset) => {
      expect(parseDateRange(serializeDateRange({ preset }))).toEqual({ preset })
    },
  )

  it('round-trips a full custom range', () => {
    const value: DateRangeValue = {
      preset: 'custom',
      fromDate: '2026-09-12',
      fromTime: '09:00',
      toDate: '2026-09-13',
      toTime: '17:30',
    }

    expect(parseDateRange(serializeDateRange(value))).toEqual(value)
  })

  /*
   * A preset rather than a pair of instants, so a shared link keeps meaning what it said. Serialising
   * the resolved window would make "last 7 days" mean one specific week to whoever opened the link
   * afterwards.
   */
  it('serialises the preset, never the instants it currently resolves to', () => {
    expect(serializeDateRange({ preset: 'week' })).toBe('week')
  })

  it('falls back to no filter for an absent or unrecognised value', () => {
    expect(parseDateRange(null)).toEqual(EMPTY_DATE_RANGE)
    expect(parseDateRange('')).toEqual(EMPTY_DATE_RANGE)
    expect(parseDateRange('last-fortnight')).toEqual(EMPTY_DATE_RANGE)
  })
})
