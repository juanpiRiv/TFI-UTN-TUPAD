import { apiFetch } from '@/lib/api'
import type { DashboardPeriod, DashboardSummary } from './schemas'

export function getSummary(
  period: DashboardPeriod,
  signal?: AbortSignal,
): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>('/api/dashboard/summary', { query: period, signal })
}
