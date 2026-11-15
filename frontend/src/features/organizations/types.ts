import type { Currency } from '@/lib/format'

export type TaxCondition = 'RESPONSABLE_INSCRIPTO' | 'MONOTRIBUTO' | 'EXENTO' | 'CONSUMIDOR_FINAL'

/** Organization as the backend returns it (Prisma model, camelCase). */
export type Organization = {
  id: number
  userId: number
  cuit: string
  legalName: string
  tradeName: string | null
  commercialAddress: string | null
  taxCondition: TaxCondition
  monotributoCategory: string | null
  activityStartDate: string | null
  grossIncomeNumber: string | null
  baseCurrency: Currency
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type IssuerMissingItem = { field: string; label: string }

/** What is still missing in the organization to be able to issue an invoice. */
export type IssuerCompleteness = { complete: boolean; missing: IssuerMissingItem[] }

/** Organization with the completeness that GET /api/organizations/me adds. */
export type OrganizationWithCompleteness = Organization & { issuerCompleteness: IssuerCompleteness }

export type ArcaPendingCsr = { csr: string; createdAt: string }

/** Response of POST /arca-credential/csr. */
export type ArcaCsr = ArcaPendingCsr

/** ARCA credential status. The private key never comes back from the server. */
export type ArcaCredentialStatus =
  | { configured: false; pendingCsr?: ArcaPendingCsr }
  | {
      configured: true
      environment: 'HOMOLOGACION' | 'PRODUCCION'
      certificateExpiresAt: string
      updatedAt: string
      pendingCsr?: ArcaPendingCsr
    }
