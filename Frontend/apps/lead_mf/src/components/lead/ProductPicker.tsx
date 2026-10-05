import React, { useCallback, useEffect, useState } from 'react';
import { ArrowLeft, Loader2 } from '@omniconnect/ui/icons';
import { Button } from '@omniconnect/ui';
import { apiClient, type CatalogCategory, type CatalogProduct } from '../../api/apiClient';
import type { SelectedProduct } from '../../types/lead';
import styles from './ProductPicker.module.css';

interface ProductPickerProps {
  /** The product already chosen, if any; shown as a summary with a way to change it. */
  productName?: string;
  /** Called with the chosen product once a product card is clicked. */
  onSelect: (product: SelectedProduct) => void;
  error?: string;
  /** Distinguishes two pickers on one page (the create form and the edit drawer never coexist, but ids must stay unique). */
  id?: string;
}

type Step = 'summary' | 'categories' | 'products';

/**
 * Category → Product, both read from the product catalogue (the Marketplace). Nothing here knows what a
 * product or category is called: the lists are whatever the Marketplace currently offers, so a category an
 * administrator switches off there disappears from this form without a release.
 */
export const ProductPicker: React.FC<ProductPickerProps> = ({ productName, onSelect, error, id = 'product-picker' }) => {
  const [step, setStep] = useState<Step>(productName ? 'summary' : 'categories');
  const [categories, setCategories] = useState<CatalogCategory[] | null>(null);
  const [category, setCategory] = useState<CatalogCategory | null>(null);
  const [products, setProducts] = useState<CatalogProduct[] | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [chosen, setChosen] = useState<CatalogProduct | null>(null);

  const loadCategories = useCallback(async () => {
    setFailure(null);
    setCategories(null);
    try {
      setCategories(await apiClient.getCatalogCategories());
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'The product catalogue could not be loaded.');
    }
  }, []);

  // The form was reset (a lead was submitted): go back to choosing.
  useEffect(() => {
    if (!productName) {
      setChosen(null);
      setStep((current) => (current === 'summary' ? 'categories' : current));
    } else {
      setStep((current) => (current === 'categories' || current === 'products' ? 'summary' : current));
    }
  }, [productName]);

  useEffect(() => {
    if (step === 'categories' && categories === null && failure === null) void loadCategories();
  }, [step, categories, failure, loadCategories]);

  const openCategory = async (next: CatalogCategory) => {
    setCategory(next);
    setStep('products');
    setProducts(null);
    setFailure(null);
    try {
      setProducts(await apiClient.getCatalogProducts(next.id));
    } catch (e) {
      setFailure(e instanceof Error ? e.message : 'The products in this category could not be loaded.');
    }
  };

  const pick = (product: CatalogProduct) => {
    setChosen(product);
    setStep('summary');
    onSelect({ id: product.id, name: product.name, subCategoryId: product.subCategoryId });
  };

  const changeProduct = () => {
    // Read the lists afresh: what is on offer may have changed since the form was opened.
    setCategories(null);
    setCategory(null);
    setProducts(null);
    setFailure(null);
    setStep('categories');
  };

  if (step === 'summary' && productName) {
    return (
      <div className={styles.wrap}>
        <span className={styles.label} id={`${id}-label`}>Product</span>
        <div className={styles.summary} role="group" aria-labelledby={`${id}-label`}>
          <div>
            <div className={styles.summaryName}>{productName}</div>
            {chosen && <div className={styles.summaryMeta}>{chosen.categoryName} · {chosen.subCategoryName}</div>}
          </div>
          <Button type="button" variant="secondary" size="sm" onClick={changeProduct}>Change product</Button>
        </div>
        {error && <div className={styles.error} role="alert">{error}</div>}
      </div>
    );
  }

  return (
    <div className={styles.wrap} id={id}>
      {/* Changing a product that is already chosen can be abandoned without picking anything. */}
      {productName && (
        <button type="button" className={styles.back} onClick={() => setStep('summary')}>
          <ArrowLeft size={14} /> Keep {productName}
        </button>
      )}
      {step === 'products' && category ? (
        <>
          <button type="button" className={styles.back} onClick={() => setStep('categories')}>
            <ArrowLeft size={14} /> All categories
          </button>
          <span className={styles.label}>Please select a product in {category.name}</span>
        </>
      ) : (
        <span className={styles.label}>Please select a category</span>
      )}

      {failure && (
        <div className={styles.notice} role="alert">
          {failure}{' '}
          <Button type="button" variant="secondary" size="sm" onClick={() => (step === 'products' && category ? void openCategory(category) : void loadCategories())}>
            Try again
          </Button>
        </div>
      )}

      {!failure && step === 'categories' && categories === null && <Loading />}
      {!failure && step === 'categories' && categories?.length === 0 && (
        <div className={styles.notice}>There are no products to take a lead for yet. Products are added and switched on in Products &amp; Marketplace.</div>
      )}
      {!failure && step === 'categories' && categories && categories.length > 0 && (
        <ul className={styles.grid} aria-label="Product categories">
          {categories.map((c) => (
            <li key={c.id}>
              <button type="button" className={styles.card} onClick={() => void openCategory(c)}>
                <span className={styles.cardTitle}>{c.name}</span>
                <span className={styles.cardMeta}>{c.productCount} {c.productCount === 1 ? 'product' : 'products'}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {!failure && step === 'products' && products === null && <Loading />}
      {!failure && step === 'products' && products?.length === 0 && (
        <div className={styles.notice}>This category has no products on offer right now.</div>
      )}
      {!failure && step === 'products' && products && products.length > 0 && (
        <ul className={styles.grid} aria-label={`Products in ${category?.name ?? 'this category'}`}>
          {products.map((p) => (
            <li key={p.id}>
              <button type="button" className={styles.card} onClick={() => pick(p)}>
                <span className={styles.cardTitle}>{p.name}</span>
                <span className={styles.cardMeta}>{p.subCategoryName}</span>
                {p.shortDescription && <span className={styles.cardText}>{p.shortDescription}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}

      {error && <div className={styles.error} role="alert">{error}</div>}
    </div>
  );
};

const Loading: React.FC = () => (
  <div className={styles.loading} role="status">
    <Loader2 size={16} className={styles.spin} /> Loading…
  </div>
);
