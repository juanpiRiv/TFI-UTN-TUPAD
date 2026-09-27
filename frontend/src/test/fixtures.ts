import type { Organization } from '@/features/organizations/types'
import { setToken } from '@/lib/auth'
import { db, nextId, nowIso } from '@/mocks/db'
import { seedDefaultCategories } from '@/mocks/handlers/categories'
import { fakeToken } from '@/mocks/jwt'

export const TEST_PASSWORD = 'clave-segura-123'

export function seedUser(email = 'lucia@example.com') {
  const user = { id: nextId(), email, password: TEST_PASSWORD, createdAt: nowIso() }
  db.users.push(user)
  return user
}

export function seedOrganization(userId: number, overrides: Partial<Organization> = {}) {
  const now = nowIso()
  const organization: Organization = {
    id: nextId(),
    userId,
    cuit: '20123456786',
    legalName: 'Lucía Pérez',
    tradeName: 'Estudio Lucía',
    commercialAddress: null,
    taxCondition: 'MONOTRIBUTO',
    monotributoCategory: null,
    activityStartDate: null,
    grossIncomeNumber: null,
    baseCurrency: 'ARS',
    isActive: true,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
  db.organizations.push(organization)
  seedDefaultCategories(organization.id)
  return organization
}

/** Leaves a user logged in, as if they had just signed in. */
export function loginAs(userId: number) {
  setToken(fakeToken(userId))
}
