import { http, HttpResponse } from 'msw'
import type { ArcaCredentialStatus } from '@/features/organizations/types'
import { API_URL } from '@/lib/api'
import { nowIso } from '../db'
import { resolveOrganization } from './context'

type Stored = Extract<ArcaCredentialStatus, { configured: true }>

/** Per organization. Only the status is kept: the key never comes back from the server. */
const credentials = new Map<number, Stored>()

/** Tests call this between cases (the shared `db` does not know about credentials). */
export function resetArcaCredentials(): void {
  credentials.clear()
}

const PATH = `${API_URL}/api/organizations/me/arca-credential`

/**
 * Test-only copy of the ARCA credential endpoints. A certificate containing "EXPIRED"
 * simulates a rejected one (422), so tests can exercise the error path.
 */
export const arcaCredentialHandlers = [
  http.get(PATH, ({ request }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    const stored = credentials.get(organization.id)
    return HttpResponse.json(stored ?? { configured: false })
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
    const now = nowIso()
    const stored: Stored = {
      configured: true,
      environment: 'HOMOLOGACION',
      certificateExpiresAt: '2028-10-21T20:51:13.000Z',
      updatedAt: now,
    }
    credentials.set(organization.id, stored)
    return HttpResponse.json(stored)
  }),

  http.delete(PATH, ({ request }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    credentials.delete(organization.id)
    return new HttpResponse(null, { status: 204 })
  }),
]
