import { describe, expect, it, vi } from 'vitest';
import axios from 'axios';
import { createPagedStore } from './createPagedStore';
import type { PagedResult } from '../types/domain';

/**
 * The one piece of list logic every catalogue screen shares.
 *
 * It is worth its own tests because each behaviour is invisible until it goes wrong on a real network: a
 * slow response arriving after a fast one, a filter narrowed while on a later page, a cancelled request
 * reported to the user as a failure.
 */

interface Query {
  search: string;
  status: string;
  page: number;
  pageSize: number;
}

const initial: Query = { search: '', status: '', page: 1, pageSize: 10 };

const result = (names: string[], totalCount = names.length): PagedResult<string> => ({
  items: names, page: 1, pageSize: 10, totalCount, totalPages: Math.max(1, Math.ceil(totalCount / 10)),
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('createPagedStore', () => {
  it('reads the list for its query and reports that it has loaded', async () => {
    const load = vi.fn().mockResolvedValue(result(['Loans', 'Cards'], 23));
    const store = createPagedStore<string, Query>(load, initial);
    expect(store.getState().loaded).toBe(false);

    await store.getState().fetch();

    expect(load).toHaveBeenCalledWith(initial, expect.any(AbortSignal), false);
    expect(store.getState()).toMatchObject({ items: ['Loans', 'Cards'], totalCount: 23, totalPages: 3, loading: false, loaded: true, error: null });
  });

  it('asks the server rather than the cache when the read is a refresh', async () => {
    const load = vi.fn().mockResolvedValue(result(['Loans']));
    const store = createPagedStore<string, Query>(load, initial);

    await store.getState().fetch({ fresh: true });

    // What a Refresh button needs: an identical URL inside the HTTP layer's 30s reuse window would
    // otherwise be answered from memory and send no request at all.
    expect(load).toHaveBeenCalledWith(initial, expect.any(AbortSignal), true);
  });

  it('returns to page 1 when a filter changes, so a narrowed list is never asked for a page that is gone', async () => {
    const store = createPagedStore<string, Query>(vi.fn().mockResolvedValue(result([])), { ...initial, page: 4 });

    store.getState().setQuery({ search: 'home' });

    expect(store.getState().query).toEqual({ ...initial, page: 1, search: 'home' });
  });

  it('keeps the filters when only the page changes', async () => {
    const store = createPagedStore<string, Query>(vi.fn().mockResolvedValue(result([])), { ...initial, search: 'home' });

    store.getState().setQuery({ page: 3 });

    expect(store.getState().query).toMatchObject({ search: 'home', page: 3 });
  });

  it('honours a page given together with a filter change', async () => {
    const store = createPagedStore<string, Query>(vi.fn().mockResolvedValue(result([])), initial);

    store.getState().setQuery({ status: 'Active', page: 2 });

    expect(store.getState().query).toMatchObject({ status: 'Active', page: 2 });
  });

  it('does not go back to page 1 for a filter set to the value it already had', async () => {
    const store = createPagedStore<string, Query>(vi.fn().mockResolvedValue(result([])), { ...initial, status: 'Active', page: 3 });

    store.getState().setQuery({ status: 'Active' });

    expect(store.getState().query.page).toBe(3);
  });

  /** The bug that makes a search box show results for what was typed a moment ago. */
  it('lets the newest request win when an older, slower one answers last', async () => {
    const slow = deferred<PagedResult<string>>();
    const fast = deferred<PagedResult<string>>();
    const load = vi.fn().mockReturnValueOnce(slow.promise).mockReturnValueOnce(fast.promise);
    const store = createPagedStore<string, Query>(load, initial);

    store.getState().setQuery({ search: 'h' });
    store.getState().setQuery({ search: 'home' });
    fast.resolve(result(['Home Loan']));
    await vi.waitFor(() => expect(store.getState().items).toEqual(['Home Loan']));
    slow.resolve(result(['Something else entirely']));
    await slow.promise;

    expect(store.getState().items).toEqual(['Home Loan']);
    expect(store.getState().loading).toBe(false);
  });

  it('cancels the request a newer one replaces', async () => {
    const signals: AbortSignal[] = [];
    const load = vi.fn((_: Query, signal: AbortSignal) => { signals.push(signal); return new Promise<PagedResult<string>>(() => undefined); });
    const store = createPagedStore<string, Query>(load, initial);

    store.getState().setQuery({ search: 'a' });
    store.getState().setQuery({ search: 'ab' });

    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
  });

  it('does not report a cancelled request as an error', async () => {
    const load = vi.fn().mockRejectedValue(new axios.CanceledError('canceled'));
    const store = createPagedStore<string, Query>(load, initial);

    await store.getState().fetch();

    expect(store.getState().error).toBeNull();
  });

  it('reports a real failure, and keeps what was already on screen', async () => {
    const load = vi.fn().mockResolvedValueOnce(result(['Loans'])).mockRejectedValueOnce(new Error('The service is unavailable.'));
    const store = createPagedStore<string, Query>(load, initial);
    await store.getState().fetch();

    await store.getState().fetch();

    expect(store.getState()).toMatchObject({ error: 'The service is unavailable.', loading: false, items: ['Loans'] });
  });

  it('clears an earlier error when the next read starts', async () => {
    const load = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValueOnce(result(['Loans']));
    const store = createPagedStore<string, Query>(load, initial);
    await store.getState().fetch();
    expect(store.getState().error).toBe('boom');

    await store.getState().fetch();

    expect(store.getState().error).toBeNull();
  });

  it('puts the query back to its starting point on reset', async () => {
    const store = createPagedStore<string, Query>(vi.fn().mockResolvedValue(result([])), initial);
    store.getState().setQuery({ search: 'home', page: 2 });

    store.getState().resetQuery();

    expect(store.getState().query).toEqual(initial);
  });
});
