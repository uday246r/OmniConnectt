import { useCallback, useEffect, useState } from 'react';

export interface RecentLookup {
  /** Exactly what was typed into the box, so picking it re-runs the same search. */
  value: string;
  /** The ID type it was searched by, so a Phone lookup is never offered under NRIC. */
  idType: string;
  /** Who it resolved to — the reason a bare identity number is recognisable a week later. */
  label: string;
}

const LIMIT = 8;

/**
 * Remembers identity lookups that actually resolved to a customer, per browser.
 *
 * The Individual and Corporate search panels have no table behind them — they take one identity
 * number and fetch one profile — so unlike every other search box on the platform there is no
 * loaded pool to recommend from. Recommending anything at all would otherwise mean querying the
 * server as the operator types a partial NRIC, which is both noisy and meaningless.
 *
 * What IS available for free is the operator's own history: a value that has already come back
 * with a profile is known-good, and re-checking a customer you looked at earlier is the common
 * case. Nothing here is fetched, and only successful lookups are stored — a typo never becomes a
 * suggestion.
 *
 * Storage is per-browser and best-effort: a private window, cleared site data, or a browser set to
 * block storage all read back empty, and some contexts throw on access, so every read and write is
 * guarded and the panel renders correctly with no history at all.
 */
export function useRecentLookups(storageKey: string) {
  const [recents, setRecents] = useState<RecentLookup[]>([]);

  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setRecents(
          parsed
            .filter((e): e is RecentLookup => Boolean(e && typeof e.value === 'string' && typeof e.idType === 'string'))
            .slice(0, LIMIT),
        );
      }
    } catch {
      // Unreadable or corrupt history is not worth surfacing — start empty.
    }
  }, [storageKey]);

  const remember = useCallback(
    (entry: RecentLookup) => {
      const value = entry.value.trim();
      if (!value) return;
      setRecents((prev) => {
        const next = [
          { ...entry, value },
          // Same value under the same ID type moves to the top rather than appearing twice.
          ...prev.filter((e) => !(e.value.toLowerCase() === value.toLowerCase() && e.idType === entry.idType)),
        ].slice(0, LIMIT);
        try {
          window.localStorage.setItem(storageKey, JSON.stringify(next));
        } catch {
          // Storage full or blocked — the list still works for this session.
        }
        return next;
      });
    },
    [storageKey],
  );

  return { recents, remember };
}
