import { bypass, http, HttpResponse } from 'msw'
import type { Me } from '@/features/auth/schemas'
import { API_URL } from '@/lib/api'
import { db, saveDb } from '../db'
import { seedDefaultCategories } from './categories'
import { seedDefaultClients } from './clients'

/**
 * Browser only. GET /api/auth/me goes to the real backend untouched; we only fill in
 * `organization` from the mock data when the backend returns null, because the real
 * backend cannot know about an organization that only exists in the mocks.
 * We also sync the real backend's organization, categories, and clients into the mock DB
 * so that any mock handlers that depend on resolveOrganization have the data they need.
 * Remove this handler once POST /api/organizations exists in the backend.
 */
export const meOverlayHandler = http.get(`${API_URL}/api/auth/me`, async ({ request }) => {
  const response = await fetch(bypass(request))
  if (!response.ok) return response

  const me = (await response.json()) as Me
  const organization =
    me.organization ?? db.organizations.find((org) => org.userId === me.id) ?? null

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

