import { apiFetch } from '@/lib/api'
import type { OrganizationInput } from './schemas'
import type { Organization } from './types'

export function createOrganization(input: OrganizationInput): Promise<Organization> {
  return apiFetch<Organization>('/api/organizations', { method: 'POST', body: input })
}

export function updateOrganization(input: Partial<OrganizationInput>): Promise<Organization> {
  return apiFetch<Organization>('/api/organizations/me', { method: 'PATCH', body: input })
}
