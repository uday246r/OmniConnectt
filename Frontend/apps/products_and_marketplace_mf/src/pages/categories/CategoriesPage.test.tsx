import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Category } from '../../types/domain';

/**
 * The Categories list, as a page.
 *
 * Nothing in this app had a page-level test, so the restructuring that moved the toolbar inside the
 * card, swapped the hand-written table for priority columns and added a Refresh button had no
 * protection at all. These cover the four things a reader of the page depends on: a placeholder while
 * it loads, the rows the server returned, a sentence rather than a blank table when there are none,
 * and — the point of the exercise — a Refresh that actually asks the server again.
 */

const list = vi.hoisted(() => vi.fn());
const summary = vi.hoisted(() => vi.fn());

vi.mock('../../services/categoryApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../services/categoryApi')>();
  return { ...actual, categoryApi: { ...actual.categoryApi, list } };
});
vi.mock('../../services/dashboardApi', () => ({ dashboardApi: { summary } }));

const { CategoriesPage } = await import('./CategoriesPage');
const { useCategoryStore } = await import('../../stores/useCategoryStore');
const { useCatalogSummaryStore } = await import('../../stores/useCatalogSummaryStore');

const category = (over: Partial<Category> = {}): Category => ({
  id: crypto.randomUUID(),
  name: 'Loans',
  code: 'LN',
  description: 'Everything lent',
  iconKey: '',
  status: 'Active',
  isLive: true,
  displayOrder: 1,
  subCategoryCount: 2,
  productCount: 4,
  createdAt: '2026-09-01T00:00:00Z',
  ...over,
});

const page = (items: Category[]) => ({ items, totalCount: items.length, totalPages: 1, page: 1, pageSize: 10 });

beforeEach(() => {
  list.mockReset().mockResolvedValue(page([category({ name: 'Loans' }), category({ name: 'Credit Cards', code: 'CC' })]));
  summary.mockReset().mockRejectedValue(new Error('not under test'));
  useCategoryStore.setState({ items: [], totalCount: 0, loading: false, loaded: false, error: null });
  useCatalogSummaryStore.setState({ summary: null, loading: false });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('CategoriesPage', () => {
  it('shows the categories the server returned', async () => {
    render(<CategoriesPage />);

    expect(await screen.findByText('Loans')).toBeInTheDocument();
    expect(screen.getByText('Credit Cards')).toBeInTheDocument();
  });

  it('says there are none rather than showing a blank table', async () => {
    list.mockResolvedValue(page([]));
    render(<CategoriesPage />);

    expect(await screen.findByText(/No categories yet/i)).toBeInTheDocument();
  });

  it('reports a failed read, and offers to try again', async () => {
    list.mockRejectedValueOnce(new Error('The categories could not be loaded.'));
    render(<CategoriesPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('The categories could not be loaded.');
    expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  it('issues a second request when Refresh is pressed, inside the cache window', async () => {
    const user = userEvent.setup();
    render(<CategoriesPage />);
    await waitFor(() => expect(list).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('button', { name: 'Refresh' }));

    // The whole point: the HTTP layer reuses a success for 30s, so without the `fresh` flag this
    // second press would be answered from memory and send nothing.
    await waitFor(() => expect(list).toHaveBeenCalledTimes(2));
    expect(list.mock.calls[1][2]).toBe(true);
  });

  it('shows a chip for an active filter, which can be removed from it', async () => {
    const user = userEvent.setup();
    render(<CategoriesPage />);
    await waitFor(() => expect(list).toHaveBeenCalled());

    useCategoryStore.getState().setQuery({ search: 'loan' });

    const chip = await screen.findByRole('button', { name: /Remove Search filter/i });
    await user.click(chip);

    await waitFor(() => expect(useCategoryStore.getState().query.search).toBe(''));
  });
});
