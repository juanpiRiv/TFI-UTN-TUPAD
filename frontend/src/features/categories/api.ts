import { apiFetch } from '@/lib/api'
import type { Category, CategoryFilters, CategoryInput } from './schemas'

export function listCategories(
  filters: CategoryFilters,
  signal?: AbortSignal,
): Promise<Category[]> {
  return apiFetch<Category[]>('/api/categories', {
    query: { type: filters.type, includeInactive: filters.includeInactive || undefined },
    signal,
  })
}

export function createCategory(input: CategoryInput): Promise<Category> {
  return apiFetch<Category>('/api/categories', { method: 'POST', body: input })
}

export function updateCategory(
  id: number,
  input: Partial<CategoryInput> & { isActive?: boolean },
): Promise<Category> {
  return apiFetch<Category>(`/api/categories/${id}`, { method: 'PATCH', body: input })
}
