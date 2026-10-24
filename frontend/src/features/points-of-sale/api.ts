import { apiFetch } from '@/lib/api'
import type {
  PointOfSale,
  PointOfSaleFilters,
  PointOfSaleInput,
  PointOfSaleUpdate,
} from './schemas'

export function listPointsOfSale(
  filters: PointOfSaleFilters,
  signal?: AbortSignal,
): Promise<PointOfSale[]> {
  return apiFetch<PointOfSale[]>('/api/points-of-sale', {
    query: { includeInactive: filters.includeInactive || undefined },
    signal,
  })
}

export function createPointOfSale(input: PointOfSaleInput): Promise<PointOfSale> {
  return apiFetch<PointOfSale>('/api/points-of-sale', { method: 'POST', body: input })
}

export function updatePointOfSale(id: number, input: PointOfSaleUpdate): Promise<PointOfSale> {
  return apiFetch<PointOfSale>(`/api/points-of-sale/${id}`, { method: 'PATCH', body: input })
}
