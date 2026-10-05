import { createPagedStore } from './createPagedStore';
import { productApi, type ProductQuery } from '../services/productApi';
import type { ProductListItem } from '../types/domain';

/** Products, a page at a time. The admin catalogue: it includes products a category above them hides. */
export const useProductStore = createPagedStore<ProductListItem, ProductQuery>(
  (query, signal) => productApi.list(query, signal),
  { search: '', categoryId: '', subCategoryId: '', status: '', sort: 'newest', page: 1, pageSize: 12 },
);
