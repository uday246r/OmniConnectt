import { useMemo } from 'react'
import { useDebouncedValue } from './useDebouncedValue'

/** A candidate the operator can be recommended. `meta` renders as a muted second line. */
export interface SuggestionSource {
  /** What gets committed as the filter, and what the typed text is matched against. */
  value: string
  /**
   * What to show instead of `value`, when the two must differ.
   *
   * Needed wherever a column displays a value it cannot filter by verbatim. The lead Contact column
   * is the case that forced it: rows store `+60 +60 17-234 5678`, the cell renders the collapsed
   * `+60 17-234 5678`, and the filter box refuses `+` outright — so recommending the stored string
   * showed a doubled prefix AND returned no rows when picked. Label it as the table reads, commit
   * what the box would have produced.
   */
  label?: string
  meta?: string
}

export interface UseSuggestionsOptions {
  /** Defaults to 200ms — the platform's convention for matching against an in-memory array. */
  delayMs?: number
  /** Longer lists stop being recommendations and start being a second table. Defaults to 8. */
  limit?: number
  /**
   * Compare digits only, on both sides. Typing `9898` then matches a stored `+91 9898 989 898`,
   * which is the difference between a phone/IC/account column recommending something and
   * recommending nothing at all.
   */
  numeric?: boolean
  /**
   * A value already applied as this filter, which is therefore dropped from the list.
   *
   * Offering back the filter that is already in force is a dead option — picking it changes
   * nothing — and it crowds out the alternatives, which are the only useful thing left to show once
   * a filter is on.
   */
  exclude?: string
}

export interface UseSuggestionsResult {
  /** The debounced, trimmed, lower-cased needle. Empty until the operator has actually typed. */
  needle: string
  items: SuggestionSource[]
}

const digitsOnly = (s: string) => s.replace(/\D+/g, '')

/**
 * Debounced "recommend what's already in this table" matching.
 *
 * Every search box in the platform needs the same four things — debounce the typed text, match it
 * against candidates, drop duplicates, cap the list — and before this each one re-implemented them
 * (or, more often, skipped them: an inventory found ~40 inputs, most with no recommendations at all
 * and a third with no debounce). Centralising it makes wiring a new box a one-liner, which is the
 * only reason applying it across three apps is tractable.
 *
 * `pool` is deliberately whatever rows the caller has ALREADY loaded, never a fetch: an operator
 * should only ever be recommended a value that is genuinely in the table in front of them, and
 * typing must not generate requests.
 */
export function useSuggestions(
  rawValue: string,
  pool: (string | SuggestionSource)[],
  { delayMs = 200, limit = 8, numeric = false, exclude }: UseSuggestionsOptions = {},
): UseSuggestionsResult {
  const debounced = useDebouncedValue(rawValue, delayMs)
  const needle = debounced.trim().toLowerCase()

  const items = useMemo(() => {
    if (!needle) return []
    const target = numeric ? digitsOnly(needle) : needle
    if (!target) return []

    const excluded = exclude?.trim().toLowerCase()
    const seen = new Set<string>()
    const out: SuggestionSource[] = []

    for (const entry of pool) {
      const candidate = typeof entry === 'string' ? { value: entry } : entry
      const value = candidate.value?.trim()
      if (!value) continue

      // Dedupe on the displayed value, keeping first-seen casing — a column of 200 rows typically
      // holds a handful of distinct values, and repeating them is noise, not choice.
      const key = value.toLowerCase()
      if (seen.has(key) || key === excluded) continue

      const haystack = numeric ? digitsOnly(value) : key
      if (!haystack.includes(target)) continue

      seen.add(key)
      out.push(candidate)
      if (out.length >= limit) break
    }

    return out
  }, [needle, pool, numeric, limit, exclude])

  return { needle, items }
}
