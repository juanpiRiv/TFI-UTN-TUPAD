import { apiFetch } from '@/lib/api'
import type { ArcaCertificateInput, ArcaCredentialInput } from './arca-credential-schemas'
import type { OrganizationInput } from './schemas'
import type {
  ArcaCredentialStatus,
  ArcaDelegationStatus,
  ArcaCsr,
  Organization,
  OrganizationWithCompleteness,
} from './types'

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

export function generateArcaCsr(): Promise<ArcaCsr> {
  return apiFetch<ArcaCsr>(`${ARCA_CREDENTIAL_PATH}/csr`, { method: 'POST' })
}

export function uploadArcaCertificate(input: ArcaCertificateInput): Promise<ArcaCredentialStatus> {
  return apiFetch<ArcaCredentialStatus>(`${ARCA_CREDENTIAL_PATH}/certificate`, {
    method: 'POST',
    body: input,
  })
}

export function getOrganizationWithCompleteness(
  signal?: AbortSignal,
): Promise<OrganizationWithCompleteness> {
  return apiFetch<OrganizationWithCompleteness>('/api/organizations/me', { signal })
}

const ARCA_DELEGATION_PATH = '/api/organizations/me/arca-delegation'

export function getArcaDelegation(signal?: AbortSignal): Promise<ArcaDelegationStatus> {
  return apiFetch<ArcaDelegationStatus>(ARCA_DELEGATION_PATH, { signal })
}

export function verifyArcaDelegation(): Promise<ArcaDelegationStatus> {
  return apiFetch<ArcaDelegationStatus>(`${ARCA_DELEGATION_PATH}/verify`, { method: 'POST' })
}

export async function deleteArcaDelegation(): Promise<undefined> {
  await apiFetch<unknown>(ARCA_DELEGATION_PATH, { method: 'DELETE' })
}
