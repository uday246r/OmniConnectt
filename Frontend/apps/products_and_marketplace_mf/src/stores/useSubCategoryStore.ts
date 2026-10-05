import { createPagedStore } from './createPagedStore';
import { subCategoryApi, type SubCategoryQuery } from '../services/subCategoryApi';
import type { SubCategory } from '../types/domain';

/** Sub-categories, a page at a time, grouped by category in the categories' own order. */
export const useSubCategoryStore = createPagedStore<SubCategory, SubCategoryQuery>(
  (query, signal) => subCategoryApi.list(query, signal),
  { search: '', categoryId: '', status: '', sort: 'order', page: 1, pageSize: 10 },
);
