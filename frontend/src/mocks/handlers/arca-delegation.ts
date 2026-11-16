import { http, HttpResponse } from 'msw'
import type { ArcaDelegationStatus } from '@/features/organizations/types'
import { API_URL } from '@/lib/api'
import { nowIso } from '../db'
import { resolveOrganization } from './context'

const PATH = `${API_URL}/api/organizations/me/arca-delegation`

export const MOCK_PLATFORM_CUIT = '30-71234567-8'

type Stored = Omit<ArcaDelegationStatus, 'available' | 'platformCuit'>

let available = false
const states = new Map<number, Stored>()

/** Default state of every test: the delegation is not offered. */
export function resetArcaDelegation(): void {
  available = false
  states.clear()
}

/** Tests opt in to the delegation option (the default handlers do not offer it). */
export function enableArcaDelegation(): void {
  available = true
}

/** Lets a test start with an organization in a given delegation state. */
export function seedArcaDelegation(organizationId: number, state: Stored): void {
  states.set(organizationId, state)
}

function bodyOf(organizationId: number): ArcaDelegationStatus {
  if (!available) return { available: false, status: 'NOT_STARTED' }
  return {
    available: true,
    platformCuit: MOCK_PLATFORM_CUIT,
    ...(states.get(organizationId) ?? { status: 'NOT_STARTED' }),
  }
}

/** Test-only copy of the delegation endpoints; verifying always succeeds unless a test overrides it. */
export const arcaDelegationHandlers = [
  http.get(PATH, ({ request }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    return HttpResponse.json(bodyOf(organization.id))
  }),

  http.post(`${PATH}/verify`, ({ request }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    if (!available) {
      return HttpResponse.json({ error: 'La delegación no está disponible.' }, { status: 409 })
    }
    const now = nowIso()
    states.set(organization.id, { status: 'VERIFIED', verifiedAt: now, lastCheckedAt: now })
    return HttpResponse.json(bodyOf(organization.id))
  }),

  http.delete(PATH, ({ request }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    states.delete(organization.id)
    return new HttpResponse(null, { status: 204 })
  }),
]
