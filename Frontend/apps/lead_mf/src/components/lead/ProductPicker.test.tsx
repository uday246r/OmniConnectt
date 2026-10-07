import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProductPicker } from './ProductPicker';

/**
 * The lead form's first step: category → sub-category → product, all from the Marketplace's catalogue.
 *
 * It was a grid of cards you clicked through; it is now three dropdowns you can type into, which is
 * the only way it works against a real catalogue. These hold what did not change with the markup:
 * nothing here knows a product or category by name, the three lists cascade (and a choice made under
 * a category is dropped when the category changes), sub-category is derived rather than fetched, an
 * empty or unreachable catalogue is said out loud instead of shown as an empty form, and choosing
 * hands back the ids the rest of the form is built from.
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
const businessLoan = {
  id: 'p2', name: 'Business Term Loan', code: 'BL_001', shortDescription: 'For registered businesses', iconKey: '',
  subCategoryId: 's2', subCategoryName: 'Business Loan', subCategoryCode: 'LN-BZ',
  categoryId: 'c1', categoryName: 'Loans', categoryCode: 'LN',
};

/** Opens a combobox by its accessible name and returns the option rows now on offer. */
async function open(user: ReturnType<typeof userEvent.setup>, name: RegExp | string) {
  await user.click(screen.getByRole('combobox', { name }));
  return screen.getAllByRole('option');
}

beforeEach(() => {
  getCatalogCategories.mockReset().mockResolvedValue([loans, cards]);
  getCatalogProducts.mockReset().mockResolvedValue([homeLoan, businessLoan]);
});

describe('ProductPicker', () => {
  it('offers the categories the catalogue returns, with how many products each has', async () => {
    const user = userEvent.setup();
    render(<ProductPicker onSelect={vi.fn()} />);
    await waitFor(() => expect(getCatalogCategories).toHaveBeenCalled());

    const options = await open(user, /Category/);

    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Loans'),
      expect.stringContaining('Credit Cards'),
    ]);
    expect(options[0]).toHaveTextContent('2 products');
    expect(options[1]).toHaveTextContent('1 product');
  });

  it('can be searched by typing any part of a name, which a grid of cards could not', async () => {
    const user = userEvent.setup();
    render(<ProductPicker onSelect={vi.fn()} />);
    await waitFor(() => expect(getCatalogCategories).toHaveBeenCalled());

    await user.click(screen.getByRole('combobox', { name: /Category/ }));
    await user.type(screen.getByRole('combobox', { name: /Category/ }), 'card');

    const options = screen.getAllByRole('option');
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Credit Cards');
  });

  it('reads the chosen category products, and hands back the product with its sub-category', async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(<ProductPicker onSelect={onSelect} />);
    await waitFor(() => expect(getCatalogCategories).toHaveBeenCalled());

    await user.click(screen.getByRole('combobox', { name: /Category/ }));
    await user.click(screen.getByRole('option', { name: /Loans/ }));
    await waitFor(() => expect(getCatalogProducts).toHaveBeenCalledWith('c1'));

    await user.click(screen.getByRole('combobox', { name: /^Product/ }));
    await user.click(screen.getByRole('option', { name: /Home Loan – Salaried/ }));

    expect(onSelect).toHaveBeenCalledWith({ id: 'p1', name: 'Home Loan – Salaried', subCategoryId: 's1' });
  });

  it('derives the sub-categories from the products it already has, with no request of its own', async () => {
    const user = userEvent.setup();
    render(<ProductPicker onSelect={vi.fn()} />);
    await waitFor(() => expect(getCatalogCategories).toHaveBeenCalled());

    await user.click(screen.getByRole('combobox', { name: /Category/ }));
    await user.click(screen.getByRole('option', { name: /Loans/ }));
    await waitFor(() => expect(getCatalogProducts).toHaveBeenCalledTimes(1));

    const options = await open(user, /Sub-category/);

    expect(options.map((o) => o.textContent)).toEqual([
      expect.stringContaining('Business Loan'),
      expect.stringContaining('Home Loan'),
    ]);
    // One call for the products, and nothing else: there is no sub-category endpoint behind this.
    expect(getCatalogProducts).toHaveBeenCalledTimes(1);
  });

  it('narrows the products to the chosen sub-category', async () => {
    const user = userEvent.setup();
    render(<ProductPicker onSelect={vi.fn()} />);
    await waitFor(() => expect(getCatalogCategories).toHaveBeenCalled());

    await user.click(screen.getByRole('combobox', { name: /Category/ }));
    await user.click(screen.getByRole('option', { name: /Loans/ }));
    await waitFor(() => expect(getCatalogProducts).toHaveBeenCalled());

    await user.click(screen.getByRole('combobox', { name: /Sub-category/ }));
    await user.click(screen.getByRole('option', { name: /Business Loan/ }));

    const options = await open(user, /^Product/);
    expect(options).toHaveLength(1);
    expect(options[0]).toHaveTextContent('Business Term Loan');
  });

  it('cannot leave a product selected under a category it does not belong to', async () => {
    const user = userEvent.setup();
    render(<ProductPicker onSelect={vi.fn()} />);
    await waitFor(() => expect(getCatalogCategories).toHaveBeenCalled());

    await user.click(screen.getByRole('combobox', { name: /Category/ }));
    await user.click(screen.getByRole('option', { name: /Loans/ }));
    await waitFor(() => expect(getCatalogProducts).toHaveBeenCalled());
    await user.click(screen.getByRole('combobox', { name: /^Product/ }));
    await user.click(screen.getByRole('option', { name: /Home Loan – Salaried/ }));

    getCatalogProducts.mockResolvedValue([]);
    await user.click(screen.getByRole('combobox', { name: /Category/ }));
    await user.click(screen.getByRole('option', { name: /Credit Cards/ }));

    await waitFor(() => expect(screen.getByRole('combobox', { name: /^Product/ })).toBeDisabled());
    expect(screen.getByRole('combobox', { name: /^Product/ })).not.toHaveValue('Home Loan – Salaried');
  });

  it('says there is nothing to take a lead for when the catalogue has no categories', async () => {
    getCatalogCategories.mockResolvedValue([]);
    render(<ProductPicker onSelect={vi.fn()} />);

    expect(await screen.findByText(/no products to take a lead for yet/i)).toBeInTheDocument();
  });

  it('says a category with no products has none, which is not the same as an error', async () => {
    getCatalogProducts.mockResolvedValue([]);
    const user = userEvent.setup();
    render(<ProductPicker onSelect={vi.fn()} />);
    await waitFor(() => expect(getCatalogCategories).toHaveBeenCalled());

    await user.click(screen.getByRole('combobox', { name: /Category/ }));
    await user.click(screen.getByRole('option', { name: /Loans/ }));

    expect(await screen.findByText(/no products on offer right now/i)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says the catalogue could not be loaded and offers to try again', async () => {
    getCatalogCategories.mockRejectedValueOnce(new Error('The product catalogue could not be loaded.'));
    const user = userEvent.setup();
    render(<ProductPicker onSelect={vi.fn()} />);

    expect(await screen.findByRole('alert')).toHaveTextContent('could not be loaded');
    await user.click(screen.getByRole('button', { name: 'Try again' }));

    await user.click(await screen.findByRole('combobox', { name: /Category/ }));
    expect(screen.getByRole('option', { name: /Loans/ })).toBeInTheDocument();
  });

  it('clears its choices and re-reads the catalogue once the form has been submitted', async () => {
    const user = userEvent.setup();
    const { rerender } = render(<ProductPicker productName="Home Loan – Salaried" onSelect={vi.fn()} />);
    await waitFor(() => expect(getCatalogCategories).toHaveBeenCalledTimes(1));

    await user.click(screen.getByRole('combobox', { name: /Category/ }));
    await user.click(screen.getByRole('option', { name: /Loans/ }));
    await waitFor(() => expect(getCatalogProducts).toHaveBeenCalled());

    // The store cleared the product, which is how a submitted form reports itself reset.
    rerender(<ProductPicker productName="" onSelect={vi.fn()} />);

    await waitFor(() => expect(getCatalogCategories).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('combobox', { name: /Sub-category/ })).toBeDisabled();
  });

  it('shows the validation message it is given against the product field', async () => {
    render(<ProductPicker onSelect={vi.fn()} error="Please enter the Product" />);

    expect(await screen.findByRole('alert')).toHaveTextContent('Please enter the Product');
    expect(screen.getByRole('combobox', { name: /^Product/ })).toHaveAttribute('aria-invalid', 'true');
  });
});
