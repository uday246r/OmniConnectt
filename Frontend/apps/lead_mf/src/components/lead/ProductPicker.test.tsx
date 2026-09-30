import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductPicker } from './ProductPicker';

/**
 * The lead form's first step: Category → Product, both from the Marketplace's catalogue.
 *
 * What matters is that nothing here knows a product or category by name — the lists are whatever the
 * catalogue returns, an empty or unreachable catalogue is said out loud (never shown as an empty form),
 * and choosing hands back the ids the rest of the form is built from.
 */

const getCatalogCategories = vi.fn();
const getCatalogProducts = vi.fn();

vi.mock('../../api/apiClient', () => ({
  apiClient: {
    getCatalogCategories: (...args: unknown[]) => getCatalogCategories(...args),
    getCatalogProducts: (...args: unknown[]) => getCatalogProducts(...args),
  },
}));

const loans = { id: 'c1', name: 'Loans', code: 'LN', iconKey: '', productCount: 2 };
const cards = { id: 'c2', name: 'Credit Cards', code: 'CC', iconKey: '', productCount: 1 };
const homeLoan = {
  id: 'p1', name: 'Home Loan – Salaried', code: 'HL_001', shortDescription: 'For salaried applicants', iconKey: '',
  subCategoryId: 's1', subCategoryName: 'Home Loan', subCategoryCode: 'LN-HM',
  categoryId: 'c1', categoryName: 'Loans', categoryCode: 'LN',
};

beforeEach(() => {
  getCatalogCategories.mockReset().mockResolvedValue([loans, cards]);
  getCatalogProducts.mockReset().mockResolvedValue([homeLoan]);
});

describe('ProductPicker', () => {
  it('offers the categories the catalogue returns, with how many products each has', async () => {
    render(<ProductPicker onSelect={vi.fn()} />);

    expect(await screen.findByRole('button', { name: /Loans/ })).toHaveTextContent('2 products');
    expect(screen.getByRole('button', { name: /Credit Cards/ })).toHaveTextContent('1 product');
  });

  it('shows the products of the chosen category and hands back the chosen one with its sub-category', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ProductPicker onSelect={onSelect} />);

    await user.click(await screen.findByRole('button', { name: /Loans/ }));
    expect(getCatalogProducts).toHaveBeenCalledWith('c1');
    await user.click(await screen.findByRole('button', { name: /Home Loan – Salaried/ }));

    expect(onSelect).toHaveBeenCalledWith({ id: 'p1', name: 'Home Loan – Salaried', subCategoryId: 's1' });
  });

  it('lets the person go back to the categories from a category', async () => {
    const user = userEvent.setup();
    render(<ProductPicker onSelect={vi.fn()} />);

    await user.click(await screen.findByRole('button', { name: /Loans/ }));
    await user.click(await screen.findByRole('button', { name: /All categories/ }));

    expect(await screen.findByRole('button', { name: /Credit Cards/ })).toBeInTheDocument();
  });

  it('says there is nothing to take a lead for when the catalogue has no categories, instead of showing nothing', async () => {
    getCatalogCategories.mockResolvedValue([]);
    render(<ProductPicker onSelect={vi.fn()} />);

    expect(await screen.findByText(/no products to take a lead for yet/i)).toBeInTheDocument();
  });

  it('says the catalogue could not be loaded and offers to try again', async () => {
    getCatalogCategories.mockRejectedValueOnce(new Error('The product catalogue could not be loaded.'));
    const user = userEvent.setup();
    render(<ProductPicker onSelect={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    expect(await screen.findByRole('button', { name: /Loans/ })).toBeInTheDocument();
  });

  it('shows an already-chosen product as a summary, and reads the catalogue afresh when it is changed', async () => {
    const user = userEvent.setup();
    render(<ProductPicker productName="Home Loan – Salaried" onSelect={vi.fn()} />);

    expect(screen.getByText('Home Loan – Salaried')).toBeInTheDocument();
    expect(getCatalogCategories).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Change product' }));

    await waitFor(() => expect(getCatalogCategories).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole('button', { name: /Credit Cards/ })).toBeInTheDocument();
  });

  it('shows the validation message it is given', async () => {
    render(<ProductPicker onSelect={vi.fn()} error="Please enter the Product" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Please enter the Product');
  });
});
