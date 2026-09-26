import type { MovementType } from '@/features/categories/schemas'
import type { Currency } from '@/lib/format'

export type DashboardPeriod = { from: string; to: string }

/**
 * Cash result of the period (docs/04-factura-cobro-y-pagos.md): non-voided transactions,
 * converted to the base currency with the rate stored in each one. Computed by the backend;
 * every amount is a decimal string.
 */
export type DashboardSummary = {
  from: string
  to: string
  currency: Currency
  income: string
  expense: string
  net: string
  transactionCount: number
  byCategory: {
    categoryId: number
    name: string
    type: MovementType
    total: string
  }[]
}
