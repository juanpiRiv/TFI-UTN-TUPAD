import { apiFetch } from '@/lib/api'
import type { Activity, ActivityFilters, ActivityInput, ActivityUpdate } from './schemas'

export function listActivities(
  filters: ActivityFilters,
  signal?: AbortSignal,
): Promise<Activity[]> {
  return apiFetch<Activity[]>('/api/activities', {
    query: { includeInactive: filters.includeInactive || undefined },
    signal,
  })
}

export function createActivity(input: ActivityInput): Promise<Activity> {
  return apiFetch<Activity>('/api/activities', { method: 'POST', body: input })
}

export function updateActivity(id: number, input: ActivityUpdate): Promise<Activity> {
  return apiFetch<Activity>(`/api/activities/${id}`, { method: 'PATCH', body: input })
}
