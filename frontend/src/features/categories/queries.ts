import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as categoriesApi from './api'
import type { CategoryFilters, CategoryInput } from './schemas'

export const categoryKeys = {
  all: ['categories'] as const,
  lists: () => [...categoryKeys.all, 'list'] as const,
  list: (filters: CategoryFilters) => [...categoryKeys.lists(), filters] as const,
}

export function useCategories(filters: CategoryFilters = {}) {
  return useQuery({
    queryKey: categoryKeys.list(filters),
    queryFn: ({ signal }) => categoriesApi.listCategories(filters, signal),
  })
}

function useInvalidateCategories() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: categoryKeys.all })
}

export function useCreateCategory() {
  const invalidate = useInvalidateCategories()
  return useMutation({ mutationFn: categoriesApi.createCategory, onSuccess: invalidate })
}

export function useUpdateCategory() {
  const invalidate = useInvalidateCategories()
  return useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: number
      input: Partial<CategoryInput> & { isActive?: boolean }
    }) => categoriesApi.updateCategory(id, input),
    onSuccess: invalidate,
  })
}
