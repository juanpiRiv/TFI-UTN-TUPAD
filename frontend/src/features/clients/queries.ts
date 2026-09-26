import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import * as clientsApi from './api'
import type { ClientFilters, ClientInput } from './schemas'

export const clientKeys = {
  all: ['clients'] as const,
  lists: () => [...clientKeys.all, 'list'] as const,
  list: (filters: ClientFilters) => [...clientKeys.lists(), filters] as const,
}

export function useClients(filters: ClientFilters = {}) {
  return useQuery({
    queryKey: clientKeys.list(filters),
    queryFn: ({ signal }) => clientsApi.listClients(filters, signal),
    placeholderData: keepPreviousData,
  })
}

function useInvalidateClients() {
  const queryClient = useQueryClient()
  return () => queryClient.invalidateQueries({ queryKey: clientKeys.all })
}

export function useCreateClient() {
  const invalidate = useInvalidateClients()
  return useMutation({ mutationFn: clientsApi.createClient, onSuccess: invalidate })
}

export function useUpdateClient() {
  const invalidate = useInvalidateClients()
  return useMutation({
    mutationFn: ({ id, input }: { id: number; input: ClientInput }) =>
      clientsApi.updateClient(id, input),
    onSuccess: invalidate,
  })
}

/** Logical delete (and undo): the client keeps its history. */
export function useSetClientActive() {
  const invalidate = useInvalidateClients()
  return useMutation({
    mutationFn: ({ id, isActive }: { id: number; isActive: boolean }) =>
      clientsApi.updateClient(id, { isActive }),
    onSuccess: invalidate,
  })
}
