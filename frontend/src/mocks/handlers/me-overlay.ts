import { bypass, http, HttpResponse } from 'msw'
import type { Me } from '@/features/auth/schemas'
import { API_URL } from '@/lib/api'
import { db } from '../db'

/**
 * Browser only. GET /api/auth/me goes to the real backend untouched; we only fill in
 * `organization` from the mock data when the backend returns null, because the real
 * backend cannot know about an organization that only exists in the mocks.
 * Remove this handler once POST /api/organizations exists in the backend.
 */
export const meOverlayHandler = http.get(`${API_URL}/api/auth/me`, async ({ request }) => {
  const response = await fetch(bypass(request))
  if (!response.ok) return response

  const me = (await response.json()) as Me
  const organization =
    me.organization ?? db.organizations.find((org) => org.userId === me.id) ?? null
  return HttpResponse.json({ ...me, organization })
})
