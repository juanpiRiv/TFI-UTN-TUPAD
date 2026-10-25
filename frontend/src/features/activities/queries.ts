import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as activitiesApi from './api'
import type { ActivityFilters, ActivityUpdate } from './schemas'

export const activityKeys = {
  all: ['activities'] as const,
  lists: () => [...activityKeys.all, 'list'] as const,
  list: (filters: ActivityFilters) => [...activityKeys.lists(), filters] as const,
}

export function useActivities(filters: ActivityFilters = {}) {
  return useQuery({
    queryKey: activityKeys.list(filters),
    queryFn: ({ signal }) => activitiesApi.listActivities(filters, signal),
  })
}

// Changing the primary activity touches two rows, so we always refetch the whole list.
function useInvalidateActivities() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: activityKeys.all })
}

export function useCreateActivity() {
  const invalidate = useInvalidateActivities()
  return useMutation({ mutationFn: activitiesApi.createActivity, onSuccess: invalidate })
}

export function useUpdateActivity() {
  const invalidate = useInvalidateActivities()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: ActivityUpdate }) =>
      activitiesApi.updateActivity(id, input),
    onSuccess: invalidate,
  })
}
