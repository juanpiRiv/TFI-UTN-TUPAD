import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as pointsOfSaleApi from './api'
import type { PointOfSaleFilters, PointOfSaleUpdate } from './schemas'

export const pointOfSaleKeys = {
  all: ['points-of-sale'] as const,
  lists: () => [...pointOfSaleKeys.all, 'list'] as const,
  list: (filters: PointOfSaleFilters) => [...pointOfSaleKeys.lists(), filters] as const,
}

export function usePointsOfSale(filters: PointOfSaleFilters = {}) {
  return useQuery({
    queryKey: pointOfSaleKeys.list(filters),
    queryFn: ({ signal }) => pointsOfSaleApi.listPointsOfSale(filters, signal),
  })
}

function useInvalidatePointsOfSale() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: pointOfSaleKeys.all })
}

export function useCreatePointOfSale() {
  const invalidate = useInvalidatePointsOfSale()
  return useMutation({ mutationFn: pointsOfSaleApi.createPointOfSale, onSuccess: invalidate })
}

export function useUpdatePointOfSale() {
  const invalidate = useInvalidatePointsOfSale()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: PointOfSaleUpdate }) =>
      pointsOfSaleApi.updatePointOfSale(id, input),
    onSuccess: invalidate,
  })
}
