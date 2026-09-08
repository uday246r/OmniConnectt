import { useState } from 'react'

export interface CommittedFilter {
  /** What is in the box right now. Drives the recommendation list, and nothing else. */
  query: string
  setQuery: (value: string) => void
  /** What the table is actually filtered by. Changes only on commit. */
  applied: string
  /** Apply a value (a picked suggestion) or the current query (Enter). */
  commit: (value?: string) => void
  /** Drop the filter and empty the box. */
  clear: () => void
  /** True while the box holds something that has not been applied yet. */
  dirty: boolean
}

/**
 * Splits "what the operator is typing" from "what the table is filtered by".
 *
 * Filters here bound the box straight to the fetch dependency, so every debounce tick re-queried
 * the table AND re-narrowed the recommendation list at the same time. Typing four characters of a
 * name reshuffled the rows underneath three times before reaching the row you were aiming at, and
 * the list you were reading kept moving while you read it.
 *
 * Keeping the two apart means typing is free — it only narrows the suggestions — and the table
 * changes exactly once, when you pick a suggestion or press Enter. Enter matters: it is the escape
 * hatch that keeps free-text search working for a value that has no suggestion behind it.
 */
export function useCommittedFilter(initial = ''): CommittedFilter {
  const [query, setQuery] = useState(initial)
  const [applied, setApplied] = useState(initial)

  return {
    query,
    setQuery,
    applied,
    commit: (value) => {
      const next = (value ?? query).trim()
      setQuery(next)
      setApplied(next)
    },
    clear: () => {
      setQuery('')
      setApplied('')
    },
    dirty: query.trim() !== applied,
  }
}
