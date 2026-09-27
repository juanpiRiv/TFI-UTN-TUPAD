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
