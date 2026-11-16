import { http, HttpResponse } from 'msw'
import type { ArcaCredentialStatus, ArcaPendingCsr } from '@/features/organizations/types'
import { API_URL } from '@/lib/api'
import { nowIso } from '../db'
import { resetArcaDelegation } from './arca-delegation'
import { resolveOrganization } from './context'

type Stored = Extract<ArcaCredentialStatus, { configured: true }>

/** Per organization. Only the status is kept: the key never comes back from the server. */
const credentials = new Map<number, Stored>()
const pendingCsrs = new Map<number, ArcaPendingCsr>()

/** Tests call this between cases (the shared `db` does not know about credentials). */
export function resetArcaCredentials(): void {
  credentials.clear()
  pendingCsrs.clear()
  resetArcaDelegation()
}

/** Lets a test start with a pending certificate request, as if it had been generated before. */
export function seedPendingCsr(organizationId: number): ArcaPendingCsr {
  const pending = {
    csr: '-----BEGIN CERTIFICATE REQUEST-----\nPENDIENTE\n-----END CERTIFICATE REQUEST-----',
    createdAt: '2026-11-01T12:00:00.000Z',
  }
  pendingCsrs.set(organizationId, pending)
  return pending
}

/** Lets a test start with a connected credential. */
export function seedConfiguredCredential(organizationId: number): void {
  credentials.set(organizationId, {
    configured: true,
    environment: 'HOMOLOGACION',
    certificateExpiresAt: '2028-10-21T20:51:13.000Z',
    updatedAt: '2026-11-01T12:00:00.000Z',
  })
}

const PATH = `${API_URL}/api/organizations/me/arca-credential`

function statusOf(organizationId: number): ArcaCredentialStatus {
  const stored = credentials.get(organizationId)
  const pendingCsr = pendingCsrs.get(organizationId)
  const base = stored ?? { configured: false as const }
  return pendingCsr ? { ...base, pendingCsr } : base
}

/**
 * Test-only copy of the ARCA credential endpoints. A certificate containing "EXPIRED"
 * simulates a rejected one (422), and "OTRO-CUIT" a certificate issued for another CUIT.
 */
export const arcaCredentialHandlers = [
  http.get(PATH, ({ request }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    return HttpResponse.json(statusOf(organization.id))
  }),

  http.post(PATH, async ({ request }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    const body = (await request.json()) as { certificate?: string; privateKey?: string }
    if (!body.certificate || !body.privateKey) {
      return HttpResponse.json({ error: 'invalid Data', details: [] }, { status: 400 })
    }
    if (body.certificate.includes('EXPIRED')) {
      return HttpResponse.json({ error: 'El certificado está vencido' }, { status: 422 })
    }
    const stored: Stored = {
      configured: true,
      environment: 'HOMOLOGACION',
      certificateExpiresAt: '2028-10-21T20:51:13.000Z',
      updatedAt: nowIso(),
    }
    credentials.set(organization.id, stored)
    pendingCsrs.delete(organization.id)
    return HttpResponse.json(statusOf(organization.id))
  }),

  http.post(`${PATH}/csr`, ({ request }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    const pending: ArcaPendingCsr = {
      csr: '-----BEGIN CERTIFICATE REQUEST-----\nNUEVA\n-----END CERTIFICATE REQUEST-----',
      createdAt: nowIso(),
    }
    pendingCsrs.set(organization.id, pending)
    return HttpResponse.json(pending, { status: 201 })
  }),

  http.post(`${PATH}/certificate`, async ({ request }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    const body = (await request.json()) as { certificate?: string }
    if (!body.certificate) {
      return HttpResponse.json({ error: 'invalid Data', details: [] }, { status: 400 })
    }
    if (!pendingCsrs.has(organization.id)) {
      return HttpResponse.json(
        { message: 'Primero generá la solicitud de certificado.' },
        { status: 422 },
      )
    }
    if (body.certificate.includes('OTRO-CUIT')) {
      return HttpResponse.json(
        { message: 'El certificado no corresponde al CUIT de tu negocio.' },
        { status: 422 },
      )
    }
    credentials.set(organization.id, {
      configured: true,
      environment: 'HOMOLOGACION',
      certificateExpiresAt: '2028-10-21T20:51:13.000Z',
      updatedAt: nowIso(),
    })
    pendingCsrs.delete(organization.id)
    return HttpResponse.json(statusOf(organization.id))
  }),

  http.delete(PATH, ({ request }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    credentials.delete(organization.id)
    pendingCsrs.delete(organization.id)
    return new HttpResponse(null, { status: 204 })
  }),
]
