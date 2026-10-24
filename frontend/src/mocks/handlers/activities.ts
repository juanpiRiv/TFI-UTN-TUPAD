import { http, HttpResponse } from 'msw'
import type { Activity, ActivityKind } from '@/features/activities/schemas'
import { API_URL } from '@/lib/api'
import { db, nextId, nowIso, saveDb } from '../db'
import { notFound, parseId, resolveOrganization } from './context'

type ActivityBody = {
  description?: string
  kind?: ActivityKind
  arcaActivityCode?: string | null
  isPrimary?: boolean
  isActive?: boolean
}

const conflict = (field: string, message: string) =>
  HttpResponse.json({ error: message, details: [{ field, message }] }, { status: 409 })

function clearPrimary(organizationId: number) {
  for (const activity of db.activities) {
    if (activity.organizationId === organizationId) activity.isPrimary = false
  }
}

/**
 * Test-only copy of the real activities endpoints (backend/src/module/activities), with the
 * same rules and status codes. In the browser these go to the backend.
 */
export const activityHandlers = [
  http.get(`${API_URL}/api/activities`, ({ request }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    const includeInactive = new URL(request.url).searchParams.get('includeInactive') === 'true'
    const activities = db.activities
      .filter((a) => a.organizationId === organization.id && (includeInactive || a.isActive))
      .sort(
        (a, b) =>
          Number(b.isPrimary) - Number(a.isPrimary) || a.description.localeCompare(b.description),
      )
    return HttpResponse.json(activities)
  }),

  http.post(`${API_URL}/api/activities`, async ({ request }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    const body = (await request.json()) as ActivityBody
    const hasActive = db.activities.some((a) => a.organizationId === organization.id && a.isActive)
    const isPrimary = body.isPrimary === true || !hasActive
    if (isPrimary) clearPrimary(organization.id)

    const now = nowIso()
    const activity: Activity = {
      id: nextId(),
      organizationId: organization.id,
      description: body.description ?? '',
      kind: body.kind ?? 'SERVICES',
      arcaActivityCode: body.arcaActivityCode ?? null,
      isPrimary,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }
    db.activities.push(activity)
    saveDb()
    return HttpResponse.json(activity, { status: 201 })
  }),

  http.patch(`${API_URL}/api/activities/:id`, async ({ request, params }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    const id = parseId(params.id)
    const activity = db.activities.find((a) => a.id === id && a.organizationId === organization.id)
    if (!activity) return notFound('Activity')

    const body = (await request.json()) as ActivityBody
    const willBeActive = body.isActive ?? activity.isActive
    if (activity.isPrimary && body.isPrimary === false) {
      return conflict(
        'isPrimary',
        'There must be a primary activity: mark another one as primary instead',
      )
    }
    if (activity.isPrimary && !willBeActive) {
      return conflict(
        'isActive',
        'The primary activity cannot be deactivated: choose another primary first',
      )
    }
    if (body.isPrimary === true && !willBeActive) {
      return conflict('isPrimary', 'An inactive activity cannot be the primary one')
    }

    if (body.isPrimary === true) clearPrimary(organization.id)
    Object.assign(activity, body, { updatedAt: nowIso() })
    saveDb()
    return HttpResponse.json(activity)
  }),
]
