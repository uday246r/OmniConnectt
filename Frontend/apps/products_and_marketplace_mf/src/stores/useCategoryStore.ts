import { createPagedStore } from './createPagedStore';
import { categoryApi, type CategoryQuery } from '../services/categoryApi';
import type { Category } from '../types/domain';

/** Categories, a page at a time, in the order the administrator arranged them. */
export const useCategoryStore = createPagedStore<Category, CategoryQuery>(
  (query, signal, fresh) => categoryApi.list(query, signal, fresh),
  { search: '', status: '', sort: 'order', page: 1, pageSize: 10 },
);
