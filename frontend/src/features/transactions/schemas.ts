import { z } from 'zod'
import type { Category, MovementType } from '@/features/categories/schemas'
import type { Currency } from '@/lib/format'
import { isDecimal, isPositiveDecimal, normalizeDecimal, optionalText } from '@/lib/schema-helpers'

/** Transaction as the backend returns it, with its category and client for display. */
export type Transaction = {
  id: number
  organizationId: number
  paymentId: number | null
  categoryId: number
  clientId: number | null
  type: MovementType
  /** Decimal string, e.g. "1500.00". */
  amount: string
  currency: Currency
  /** Decimal string copied at creation time (RN-06). Null when the currency is the base one. */
  exchangeRate: string | null
  transactionDate: string
  description: string | null
  voidedAt: string | null
  createdAt: string
  updatedAt: string
  category: Pick<Category, 'id' | 'name' | 'type'>
  client: { id: number; name: string } | null
}

export type TransactionFilters = {
  from?: string
  to?: string
  type?: MovementType
  categoryId?: number
  clientId?: number
}

/** Suggested management exchange rate (docs/05-cotizacion.md). */
export type ExchangeRate = {
  date: string
  observedAt: string
  value: string
  source: 'BCRA' | 'MANUAL'
  rateType: string
}

type SchemaContext = {
  categories: Category[]
  baseCurrency: Currency
}

/**
 * Transaction form rules (RN-02..RN-05):
 * - amount greater than zero;
 * - currency required;
 * - exchange rate required when the currency is not the organization's base currency;
 * - the category must have the same type as the transaction.
 */
export function createTransactionSchema({ categories, baseCurrency }: SchemaContext) {
  return z
    .object({
      type: z.enum(['INCOME', 'EXPENSE'], { error: 'Elegí si es un ingreso o un egreso' }),
      amount: z.string(),
      currency: z.enum(['', 'ARS', 'USD']),
      exchangeRate: z.string(),
      categoryId: z.string(),
      clientId: z.string(),
      transactionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Elegí la fecha'),
      description: optionalText(255),
    })
    .superRefine((values, ctx) => {
      const amount = normalizeDecimal(values.amount)
      if (amount === '') {
        ctx.addIssue({ code: 'custom', path: ['amount'], message: 'Ingresá el importe' })
      } else if (!isDecimal(amount, 2)) {
        ctx.addIssue({
          code: 'custom',
          path: ['amount'],
          message: 'Importe inválido, hasta 2 decimales',
        })
      } else if (!isPositiveDecimal(amount)) {
        ctx.addIssue({
          code: 'custom',
          path: ['amount'],
          message: 'El importe tiene que ser mayor a cero',
        })
      }

      if (values.currency === '') {
        ctx.addIssue({ code: 'custom', path: ['currency'], message: 'Elegí la moneda' })
      } else if (values.currency !== baseCurrency) {
        const rate = normalizeDecimal(values.exchangeRate)
        if (rate === '') {
          ctx.addIssue({
            code: 'custom',
            path: ['exchangeRate'],
            message: 'Ingresá el tipo de cambio',
          })
        } else if (!isDecimal(rate, 6) || !isPositiveDecimal(rate)) {
          ctx.addIssue({
            code: 'custom',
            path: ['exchangeRate'],
            message: 'Tipo de cambio inválido, mayor a cero y hasta 6 decimales',
          })
        }
      }

      const category = categories.find((candidate) => String(candidate.id) === values.categoryId)
      if (!category) {
        ctx.addIssue({ code: 'custom', path: ['categoryId'], message: 'Elegí una categoría' })
      } else if (category.type !== values.type) {
        ctx.addIssue({
          code: 'custom',
          path: ['categoryId'],
          message: 'La categoría tiene que ser del mismo tipo que el movimiento',
        })
      }
    })
    .transform((values) => ({
      type: values.type,
      amount: normalizeDecimal(values.amount),
      currency: values.currency as Currency,
      exchangeRate: values.currency === baseCurrency ? null : normalizeDecimal(values.exchangeRate),
      categoryId: Number(values.categoryId),
      clientId: values.clientId === '' ? null : Number(values.clientId),
      transactionDate: values.transactionDate,
      description: values.description,
    }))
}

export type TransactionFormValues = z.input<ReturnType<typeof createTransactionSchema>>
export type TransactionInput = z.output<ReturnType<typeof createTransactionSchema>>

export const transactionFields = [
  'type',
  'amount',
  'currency',
  'exchangeRate',
  'categoryId',
  'clientId',
  'transactionDate',
  'description',
] as const satisfies readonly (keyof TransactionFormValues)[]
