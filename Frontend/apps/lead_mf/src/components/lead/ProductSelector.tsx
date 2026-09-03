import React, { useEffect } from 'react';
import { SearchableDropdown } from '../common/SearchableDropdown';
import { useLeadStore } from '../../store/useLeadStore';
import styles from './ProductSelector.module.css';

export const ProductSelector: React.FC = () => {
  const { formData, setProduct, errors, products, fetchMasterData, validateField } = useLeadStore();

  useEffect(() => {
    if (products.length === 0) {
      fetchMasterData();
    }
  }, [products.length, fetchMasterData]);

  return (
    <div className={styles.grid}>
      <SearchableDropdown
        id="product-selector-field"
        label="Please select a product"
        placeholder="Select a financing product"
        options={products}
        value={formData.product}
        onChange={(val) => setProduct(val)}
        onBlur={() => validateField('product')}
        required
        error={errors.product}
      />
    </div>
  );
};
