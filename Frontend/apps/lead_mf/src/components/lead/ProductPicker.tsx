import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Button, Combobox, FormField, FormGrid, type ComboboxOption } from '@omniconnect/ui';
import { apiClient, type CatalogCategory, type CatalogProduct } from '../../api/apiClient';
import type { SelectedProduct } from '../../types/lead';
import styles from './ProductPicker.module.css';

interface ProductPickerProps {
  /** The product already chosen, if any. */
  productName?: string;
  /** Called with the chosen product. */
  onSelect: (product: SelectedProduct) => void;
  error?: string;
  /** Distinguishes two pickers on one page (the create form and the edit drawer never coexist, but ids must stay unique). */
  id?: string;
}

/**
 * Category -> sub-category -> product, each a dropdown you can type into.
 *
 * This was a two-step grid of cards with no search anywhere: you clicked a category, the grid was
 * replaced by a grid of products, and you clicked one. That reads fine against six demo products and
 * not at all against a real catalogue — a wall of cards, no way to type a name you already know, and
 * a sub-category you could never select even though Field Settings is organised by it.
 *
 * Nothing here knows what a product or category is called. The lists are whatever the Marketplace
 * currently offers, so a category an administrator switches off there disappears from this form
 * without a release.
 *
 * Sub-category needs no endpoint of its own: it is derived from the products already fetched for the
 * chosen category. It narrows the product list and is never required — on a small catalogue you go
 * straight from category to product.
 */
export const ProductPicker: React.FC<ProductPickerProps> = ({ productName, onSelect, error, id = 'product-picker' }) => {
  const [categories, setCategories] = useState<CatalogCategory[] | null>(null);
  const [categoryId, setCategoryId] = useState('');
  const [products, setProducts] = useState<CatalogProduct[] | null>(null);
  const [subCategoryId, setSubCategoryId] = useState('');
  const [productId, setProductId] = useState('');
  const [failure, setFailure] = useState<string | null>(null);

  const loadCategories = useCallback(async () => {
    setFailure(null);
    setCategories(null);
    try {
      setCategories(await apiClient.getCatalogCategories());
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'The product catalogue could not be loaded.');
    }
  }, []);

  const loadProducts = useCallback(async (forCategoryId: string) => {
    setFailure(null);
    setProducts(null);
    try {
      setProducts(await apiClient.getCatalogProducts(forCategoryId));
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'The products in this category could not be loaded.');
    }
  }, []);

  useEffect(() => {
    if (categories === null && failure === null) void loadCategories();
  }, [categories, failure, loadCategories]);

  // The form was reset (a lead was submitted): clear the choices so the next lead starts clean, and
  // read the lists afresh, because what is on offer may have changed since the form was opened.
  useEffect(() => {
    if (!productName) {
      setProductId('');
      setSubCategoryId('');
      setCategoryId('');
      setProducts(null);
      setCategories(null);
      setFailure(null);
    }
  }, [productName]);

  const chooseCategory = (next: string) => {
    setCategoryId(next);
    // A product belongs to exactly one category, so changing category invalidates both choices under it.
    setSubCategoryId('');
    setProductId('');
    setProducts(null);
    if (next) void loadProducts(next);
  };

  const chooseSubCategory = (next: string) => {
    setSubCategoryId(next);
    // Keep the product only if it is still in view under the narrowed list.
    if (next && productId && products?.find((p) => p.id === productId)?.subCategoryId !== next) setProductId('');
  };

  const chooseProduct = (next: string) => {
    setProductId(next);
    const product = products?.find((p) => p.id === next);
    if (!product) return;
    // Selecting the product is what tells the form which field configuration to load, so the
    // sub-category follows the product rather than the other way round.
    if (!subCategoryId) setSubCategoryId(product.subCategoryId);
    onSelect({ id: product.id, name: product.name, subCategoryId: product.subCategoryId });
  };

  const categoryOptions: ComboboxOption[] = useMemo(
    () =>
      (categories ?? []).map((c) => ({
        value: c.id,
        label: c.name,
        description: `${c.productCount} ${c.productCount === 1 ? 'product' : 'products'}`,
        keywords: c.code,
      })),
    [categories],
  );

  /** Derived from the products already fetched — one row per sub-category that actually has products. */
  const subCategoryOptions: ComboboxOption[] = useMemo(() => {
    const counts = new Map<string, { name: string; count: number }>();
    for (const product of products ?? []) {
      const seen = counts.get(product.subCategoryId);
      if (seen) seen.count += 1;
      else counts.set(product.subCategoryId, { name: product.subCategoryName, count: 1 });
    }
    return [...counts.entries()]
      .sort((a, b) => a[1].name.localeCompare(b[1].name))
      .map(([value, { name, count }]) => ({
        value,
        label: name,
        description: `${count} ${count === 1 ? 'product' : 'products'}`,
      }));
  }, [products]);

  const productOptions: ComboboxOption[] = useMemo(
    () =>
      (products ?? [])
        .filter((p) => !subCategoryId || p.subCategoryId === subCategoryId)
        .map((p) => ({
          value: p.id,
          label: p.name,
          // The sub-category stays on the row even when it is already the filter: it is how people
          // tell two similarly named products apart.
          description: [p.subCategoryName, p.shortDescription].filter(Boolean).join(' · '),
          keywords: p.code,
        })),
    [products, subCategoryId],
  );

  const retry = () => (categoryId ? void loadProducts(categoryId) : void loadCategories());

  // A catalogue with nothing in it is not a failure, and must not read like one.
  const emptyCatalogue = !failure && categories?.length === 0;

  return (
    <div className={styles.wrap} id={id}>
      {failure && (
        <div className={styles.notice} role="alert">
          {failure}{' '}
          <Button type="button" variant="secondary" size="sm" onClick={retry}>
            Try again
          </Button>
        </div>
      )}

      {emptyCatalogue && (
        <div className={styles.notice}>
          There are no products to take a lead for yet. Products are added and switched on in Products
          &amp; Marketplace.
        </div>
      )}

      <FormGrid columns={3}>
        <FormField label="Category" required>
          {(control) => (
            <Combobox
              id={control.id}
              options={categoryOptions}
              value={categoryId}
              onChange={chooseCategory}
              loading={categories === null && !failure}
              disabled={Boolean(emptyCatalogue)}
              placeholder="Select a category"
              emptyMessage="No matching category"
            />
          )}
        </FormField>

        <FormField
          label="Sub-category"
          helper={categoryId && subCategoryOptions.length > 1 ? 'Optional — narrows the products below' : undefined}
        >
          {(control) => (
            <Combobox
              id={control.id}
              options={subCategoryOptions}
              value={subCategoryId}
              onChange={chooseSubCategory}
              loading={Boolean(categoryId) && products === null && !failure}
              disabled={!categoryId || subCategoryOptions.length === 0}
              clearLabel={subCategoryId ? 'All sub-categories' : undefined}
              placeholder={categoryId ? 'All sub-categories' : 'Choose a category first'}
              emptyMessage="No matching sub-category"
            />
          )}
        </FormField>

        <FormField label="Product" required error={error}>
          {(control) => (
            <Combobox
              id={control.id}
              aria-describedby={control.describedBy}
              invalid={control.invalid}
              options={productOptions}
              value={productId}
              onChange={chooseProduct}
              loading={Boolean(categoryId) && products === null && !failure}
              disabled={!categoryId || productOptions.length === 0}
              placeholder={categoryId ? 'Select a product' : 'Choose a category first'}
              emptyMessage="No matching product"
            />
          )}
        </FormField>
      </FormGrid>

      {!failure && categoryId && products?.length === 0 && (
        <p className={styles.hint}>This category has no products on offer right now.</p>
      )}
    </div>
  );
};
