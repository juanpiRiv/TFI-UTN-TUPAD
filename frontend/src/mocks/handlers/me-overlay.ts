import { bypass, http, HttpResponse } from 'msw'
import type { Me } from '@/features/auth/schemas'
import { API_URL } from '@/lib/api'
import { db, saveDb } from '../db'
import { seedDefaultCategories } from './categories'
import { seedDefaultClients } from './clients'

/**
 * Browser only. GET /api/auth/me goes to the real backend untouched. The organization now
 * comes from the backend (POST /api/organizations exists), so we never invent one here.
 * We only copy the real organization into the mock DB and seed its categories and clients,
 * because the category handlers are still mocked and need them (resolveOrganization).
 * Remove this handler once the categories endpoints exist in the backend.
 */
export const meOverlayHandler = http.get(`${API_URL}/api/auth/me`, async ({ request }) => {
  const response = await fetch(bypass(request))
  if (!response.ok) return response

  const me = (await response.json()) as Me
  const organization = me.organization

  if (organization) {
    const existingIndex = db.organizations.findIndex((org) => org.id === organization.id)
    if (existingIndex >= 0) {
      db.organizations[existingIndex] = organization
    } else {
      db.organizations.push(organization)
    }

    const orgId = organization.id
    const existingCatIds = new Set(
      db.categories.filter((cat) => cat.organizationId === orgId).map((cat) => cat.id),
    )
    if (existingCatIds.size === 0) {
      seedDefaultCategories(orgId)
    }

    const existingClientIds = new Set(
      db.clients.filter((cli) => cli.organizationId === orgId).map((cli) => cli.id),
    )
    if (existingClientIds.size === 0) {
      seedDefaultClients(orgId)
    }

    saveDb()
  }

  return HttpResponse.json({ ...me, organization })
})

