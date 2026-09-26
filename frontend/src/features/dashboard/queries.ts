import { keepPreviousData, useQuery } from '@tanstack/react-query'
import * as dashboardApi from './api'
import type { DashboardPeriod } from './schemas'

export const dashboardKeys = {
  all: ['dashboard'] as const,
  summary: (period: DashboardPeriod) => [...dashboardKeys.all, 'summary', period] as const,
}

export function useDashboardSummary(period: DashboardPeriod) {
  return useQuery({
    queryKey: dashboardKeys.summary(period),
    queryFn: ({ signal }) => dashboardApi.getSummary(period, signal),
    placeholderData: keepPreviousData,
  })
}
