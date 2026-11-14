import { apiFetch } from '@/lib/api'
import type { ArcaCredentialInput } from './arca-credential-schemas'
import type { OrganizationInput } from './schemas'
import type { ArcaCredentialStatus, Organization } from './types'

export function createOrganization(input: OrganizationInput): Promise<Organization> {
  return apiFetch<Organization>('/api/organizations', { method: 'POST', body: input })
}

export function updateOrganization(input: Partial<OrganizationInput>): Promise<Organization> {
  return apiFetch<Organization>('/api/organizations/me', { method: 'PATCH', body: input })
}

const ARCA_CREDENTIAL_PATH = '/api/organizations/me/arca-credential'

export function getArcaCredential(signal?: AbortSignal): Promise<ArcaCredentialStatus> {
  return apiFetch<ArcaCredentialStatus>(ARCA_CREDENTIAL_PATH, { signal })
}

export function saveArcaCredential(input: ArcaCredentialInput): Promise<ArcaCredentialStatus> {
  return apiFetch<ArcaCredentialStatus>(ARCA_CREDENTIAL_PATH, { method: 'POST', body: input })
}

export async function deleteArcaCredential(): Promise<undefined> {
  await apiFetch<unknown>(ARCA_CREDENTIAL_PATH, { method: 'DELETE' })
}
