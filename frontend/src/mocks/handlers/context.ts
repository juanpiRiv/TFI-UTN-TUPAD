import { HttpResponse } from 'msw'
import type { Organization } from '@/features/organizations/types'
import { db } from '../db'
import { userIdFromRequest } from '../jwt'

type Context = { userId: number; organization: Organization | null }

/**
 * Resolves who is calling. Returns an error response (same shape as the backend's
 * `{ error }`) when there is no valid token.
 */
export function resolveUser(request: Request): Context | Response {
  const userId = userIdFromRequest(request)
  if (!userId) return HttpResponse.json({ error: 'Missing token' }, { status: 401 })
  const organization = db.organizations.find((org) => org.userId === userId) ?? null
  return { userId, organization }
}

/** Same as resolveUser, but the user must already have an organization. */
export function resolveOrganization(request: Request): Organization | Response {
  const context = resolveUser(request)
  if (context instanceof Response) return context
  if (!context.organization) {
    return HttpResponse.json({ error: 'Organization required' }, { status: 403 })
  }
  return context.organization
}

export type FieldDetail = { field: string; message: string }

export function invalidData(details: FieldDetail[]): Response {
  return HttpResponse.json({ error: 'invalid Data', details }, { status: 400 })
}

export function notFound(entity: string): Response {
  return HttpResponse.json({ error: `${entity} not found` }, { status: 404 })
}

/** Parses a numeric route param such as `:id`. */
export function parseId(value: string | readonly string[] | undefined): number | null {
  const id = Number(value)
  return Number.isInteger(id) && id > 0 ? id : null
}
