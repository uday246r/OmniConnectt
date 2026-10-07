import axios from 'axios';
import { create } from 'zustand';
import type { PagedResult } from '../types/domain';

export interface PagedQuery {
  page: number;
  pageSize: number;
}

export interface PagedState<T, Q extends PagedQuery> {
  items: T[];
  totalCount: number;
  totalPages: number;
  query: Q;
  loading: boolean;
  /** Set once the list has been read at least once, so a screen can tell "empty" from "not loaded yet". */
  loaded: boolean;
  error: string | null;

  /**
   * Reads the list for the current query.
   *
   * `fresh` asks the server rather than accepting the briefly-cached answer — what a Refresh button
   * needs. Without it a Refresh re-sending an identical URL within the cache window made no request
   * at all: the spinner turned and the same rows came back.
   */
  fetch: (options?: { fresh?: boolean }) => Promise<void>;
  /**
   * Changes the query and reads the list again. Changing anything but the page returns to page 1 —
   * otherwise narrowing a filter while on page 4 would ask for a page that no longer exists.
   */
  setQuery: (patch: Partial<Q>) => void;
  resetQuery: () => void;
}

/**
 * One list's state: its query, its current page of rows, and how they were fetched.
 *
 * Every list screen (categories, sub-categories, products) needs the same three things, and each is easy
 * to get subtly wrong:
 *
 * - A newer request must win. Typing in a search box fires a request per pause; if an earlier, slower
 *   one answers last it must not overwrite the newer result.
 * - A superseded request is cancelled rather than left running.
 * - A cancelled request is not an error and must not show one.
 *
 * Reading through a selector (`useStore((s) => s.items)`) is what keeps a screen from re-rendering on
 * every write to the store; never subscribe to the whole store.
 */
export function createPagedStore<T, Q extends PagedQuery>(
  load: (query: Q, signal: AbortSignal, fresh: boolean) => Promise<PagedResult<T>>,
  initialQuery: Q,
) {
  let controller: AbortController | null = null;
  let latest = 0;

  return create<PagedState<T, Q>>((set, get) => ({
    items: [],
    totalCount: 0,
    totalPages: 0,
    query: initialQuery,
    loading: false,
    loaded: false,
    error: null,

    fetch: async (options) => {
      controller?.abort();
      controller = new AbortController();
      const mine = ++latest;
      set({ loading: true, error: null });

      try {
        const result = await load(get().query, controller.signal, options?.fresh === true);
        if (mine !== latest) return;
        set({ items: result.items, totalCount: result.totalCount, totalPages: result.totalPages, loading: false, loaded: true });
      } catch (error) {
        if (mine !== latest || axios.isCancel(error)) return;
        set({ error: (error as Error).message, loading: false, loaded: true });
      }
    },

    setQuery: (patch) => {
      const current = get().query;
      const changesFilter = (Object.keys(patch) as (keyof Q)[]).some((key) => key !== 'page' && patch[key] !== current[key]);
      const returnToFirstPage = changesFilter && !('page' in patch);
      set({ query: { ...current, ...patch, ...(returnToFirstPage ? { page: 1 } : {}) } });
      void get().fetch();
    },

    resetQuery: () => {
      set({ query: initialQuery });
      void get().fetch();
    },
  }));
}
