import { http, HttpResponse } from 'msw'
import type { PointOfSale } from '@/features/points-of-sale/schemas'
import { API_URL } from '@/lib/api'
import { db, nextId, nowIso, saveDb } from '../db'
import { notFound, parseId, resolveOrganization } from './context'

type PointOfSaleBody = { number?: number; address?: string | null; isActive?: boolean }

const conflict = (field: string, message: string) =>
  HttpResponse.json({ error: message, details: [{ field, message }] }, { status: 409 })

const numberTaken = () => conflict('number', 'There is already a point of sale with that number')

/**
 * Test-only copy of the real points of sale endpoints (backend/src/module/points-of-sale),
 * with the same rules and status codes. In the browser these go to the backend.
 */
export const pointOfSaleHandlers = [
  http.get(`${API_URL}/api/points-of-sale`, ({ request }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    const includeInactive = new URL(request.url).searchParams.get('includeInactive') === 'true'
    const pointsOfSale = db.pointsOfSale
      .filter((pos) => pos.organizationId === organization.id && (includeInactive || pos.isActive))
      .sort((a, b) => a.number - b.number)
    return HttpResponse.json(pointsOfSale)
  }),

  http.post(`${API_URL}/api/points-of-sale`, async ({ request }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    const body = (await request.json()) as PointOfSaleBody
    if (
      db.pointsOfSale.some(
        (pos) => pos.organizationId === organization.id && pos.number === body.number,
      )
    ) {
      return numberTaken()
    }

    const now = nowIso()
    const pointOfSale: PointOfSale = {
      id: nextId(),
      organizationId: organization.id,
      number: body.number ?? 1,
      billingMethod: 'CAE',
      address: body.address ?? null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }
    db.pointsOfSale.push(pointOfSale)
    saveDb()
    return HttpResponse.json(pointOfSale, { status: 201 })
  }),

  http.patch(`${API_URL}/api/points-of-sale/:id`, async ({ request, params }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    const id = parseId(params.id)
    const pointOfSale = db.pointsOfSale.find(
      (pos) => pos.id === id && pos.organizationId === organization.id,
    )
    if (!pointOfSale) return notFound('Point of sale')

    const body = (await request.json()) as PointOfSaleBody
    if (
      body.number !== undefined &&
      db.pointsOfSale.some(
        (pos) =>
          pos.organizationId === organization.id && pos.number === body.number && pos.id !== id,
      )
    ) {
      return numberTaken()
    }
    if (body.isActive === false && pointOfSale.isActive) {
      const otherActive = db.pointsOfSale.some(
        (pos) => pos.organizationId === organization.id && pos.isActive && pos.id !== id,
      )
      if (!otherActive)
        return conflict('isActive', 'There must be at least one active point of sale')
    }

    Object.assign(pointOfSale, body, { updatedAt: nowIso() })
    saveDb()
    return HttpResponse.json(pointOfSale)
  }),
]
