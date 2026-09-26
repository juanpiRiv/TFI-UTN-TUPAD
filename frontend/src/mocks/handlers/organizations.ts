import { http, HttpResponse } from 'msw'
import { isValidCuit } from '@/features/organizations/schemas'
import type { Organization } from '@/features/organizations/types'
import { API_URL } from '@/lib/api'
import { db, nextId, nowIso, saveDb } from '../db'
import { seedDefaultCategories } from './categories'
import { invalidData, resolveOrganization, resolveUser, type FieldDetail } from './context'

type OrganizationBody = Partial<Omit<Organization, 'id' | 'userId' | 'isActive'>>

function validate(body: OrganizationBody, partial: boolean): FieldDetail[] {
  const details: FieldDetail[] = []
  if ((!partial || body.cuit !== undefined) && !isValidCuit(body.cuit ?? '')) {
    details.push({ field: 'cuit', message: 'Invalid CUIT' })
  }
  if ((!partial || body.legalName !== undefined) && !body.legalName?.trim()) {
    details.push({ field: 'legalName', message: 'Required' })
  }
  if (
    (!partial || body.baseCurrency !== undefined) &&
    !['ARS', 'USD'].includes(body.baseCurrency ?? '')
  ) {
    details.push({ field: 'baseCurrency', message: 'Invalid currency' })
  }
  return details
}

function cuitTaken(cuit: string | undefined, exceptId?: number): boolean {
  return db.organizations.some((org) => org.cuit === cuit && org.id !== exceptId)
}

export const organizationHandlers = [
  http.post(`${API_URL}/api/organizations`, async ({ request }) => {
    const context = resolveUser(request)
    if (context instanceof Response) return context
    if (context.organization) {
      return HttpResponse.json({ error: 'Organization already exists' }, { status: 409 })
    }
    const body = (await request.json()) as OrganizationBody
    const details = validate(body, false)
    if (details.length) return invalidData(details)
    if (cuitTaken(body.cuit)) {
      return HttpResponse.json({ error: 'CUIT already registered' }, { status: 409 })
    }

    const now = nowIso()
    const organization: Organization = {
      id: nextId(),
      userId: context.userId,
      cuit: body.cuit ?? '',
      legalName: body.legalName ?? '',
      tradeName: body.tradeName ?? null,
      commercialAddress: body.commercialAddress ?? null,
      taxCondition: body.taxCondition ?? 'MONOTRIBUTO',
      monotributoCategory: body.monotributoCategory ?? null,
      activityStartDate: body.activityStartDate ?? null,
      grossIncomeNumber: body.grossIncomeNumber ?? null,
      baseCurrency: body.baseCurrency ?? 'ARS',
      isActive: true,
      createdAt: now,
      updatedAt: now,
    }
    db.organizations.push(organization)
    seedDefaultCategories(organization.id)
    saveDb()
    return HttpResponse.json(organization, { status: 201 })
  }),

  http.get(`${API_URL}/api/organizations/me`, ({ request }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    return HttpResponse.json(organization)
  }),

  http.patch(`${API_URL}/api/organizations/me`, async ({ request }) => {
    const organization = resolveOrganization(request)
    if (organization instanceof Response) return organization
    const body = (await request.json()) as OrganizationBody
    const details = validate(body, true)
    if (details.length) return invalidData(details)
    if (body.cuit !== undefined && cuitTaken(body.cuit, organization.id)) {
      return HttpResponse.json({ error: 'CUIT already registered' }, { status: 409 })
    }
    Object.assign(organization, body, { updatedAt: nowIso() })
    saveDb()
    return HttpResponse.json(organization)
  }),
]
