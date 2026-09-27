import { apiFetch } from '@/lib/api'
import type { Client, ClientFilters, ClientInput } from './schemas'

export function listClients(filters: ClientFilters, signal?: AbortSignal): Promise<Client[]> {
  return apiFetch<Client[]>('/api/clients', {
    query: { search: filters.search, includeInactive: filters.includeInactive || undefined },
    signal,
  })
}

export function createClient(input: ClientInput): Promise<Client> {
  return apiFetch<Client>('/api/clients', { method: 'POST', body: input })
}

export function updateClient(
  id: number,
  input: Partial<ClientInput> & { isActive?: boolean },
): Promise<Client> {
  return apiFetch<Client>(`/api/clients/${id}`, { method: 'PATCH', body: input })
}
