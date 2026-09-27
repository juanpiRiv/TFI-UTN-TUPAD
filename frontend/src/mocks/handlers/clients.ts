import { http, HttpResponse } from 'msw'
import type { Client } from '@/features/clients/schemas'
import { API_URL } from '@/lib/api'
import { db, nextId, nowIso, saveDb } from '../db'
import { invalidData, notFound, parseId, resolveOrganization, type FieldDetail } from './context'

type ClientBody = Partial<Omit<Client, 'id' | 'organizationId' | 'createdAt' | 'updatedAt'>>

function validate(body: ClientBody, partial: boolean): FieldDetail[] {
  const details: FieldDetail[] = []
  if ((!partial || body.name !== undefined) && !body.name?.trim()) {
    details.push({ field: 'name', message: 'Required' })
  }
  return details
}

function duplicatedDocument(organizationId: number, body: ClientBody, exceptId?: number): boolean {
  if (!body.docType || !body.docNumber) return false
  return db.clients.some(
    (client) =>
      client.organizationId === organizationId &&
      client.docType === body.docType &&
      client.docNumber === body.docNumber &&
      client.id !== exceptId,
  )
}

export const clientHandlers = [
  http.get(`${API_URL}/api/clients`, ({ request }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    const params = new URL(request.url).searchParams
    const search = params.get('search')?.trim().toLowerCase()
    const includeInactive = params.get('includeInactive') === 'true'

    const clients = db.clients
      .filter((client) => client.organizationId === organization.id)
      .filter((client) => includeInactive || client.isActive)
      .filter(
        (client) =>
          !search ||
          [client.name, client.docNumber, client.email].some((value) =>
            value?.toLowerCase().includes(search),
          ),
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'es'))
    return HttpResponse.json(clients)
  }),

  http.get(`${API_URL}/api/clients/:id`, ({ request, params }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    const client = db.clients.find(
      (candidate) =>
        candidate.id === parseId(params.id) && candidate.organizationId === organization.id,
    )
    return client ? HttpResponse.json(client) : notFound('Client')
  }),

  http.post(`${API_URL}/api/clients`, async ({ request }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    const body = (await request.json()) as ClientBody
    const details = validate(body, false)
    if (details.length) return invalidData(details)
    if (duplicatedDocument(organization.id, body)) {
      return HttpResponse.json({ error: 'Client document already registered' }, { status: 409 })
    }
    const now = nowIso()
    const client: Client = {
      id: nextId(),
      organizationId: organization.id,
      name: body.name?.trim() ?? '',
      docType: body.docType ?? null,
      docNumber: body.docNumber ?? null,
      address: body.address ?? null,
      taxCondition: body.taxCondition ?? null,
      email: body.email ?? null,
      phone: body.phone ?? null,
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }
    db.clients.push(client)
    saveDb()
    return HttpResponse.json(client, { status: 201 })
  }),

  http.patch(`${API_URL}/api/clients/:id`, async ({ request, params }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    const client = db.clients.find(
      (candidate) =>
        candidate.id === parseId(params.id) && candidate.organizationId === organization.id,
    )
    if (!client) return notFound('Client')
    const body = (await request.json()) as ClientBody
    const details = validate(body, true)
    if (details.length) return invalidData(details)
    if (duplicatedDocument(organization.id, { ...client, ...body }, client.id)) {
      return HttpResponse.json({ error: 'Client document already registered' }, { status: 409 })
    }
    Object.assign(client, body, { updatedAt: nowIso() })
    saveDb()
    return HttpResponse.json(client)
  }),
]
