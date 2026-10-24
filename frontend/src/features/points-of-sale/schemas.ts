import { z } from 'zod'
import { optionalText } from '@/lib/schema-helpers'

/** Point of sale as the backend returns it (Prisma model, camelCase). */
export type PointOfSale = {
  id: number
  organizationId: number
  number: number
  billingMethod: 'CAE' | 'CAEA'
  address: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type PointOfSaleFilters = { includeInactive?: boolean }

/** ARCA shows the point of sale with 5 digits: 3 → "00003". */
export function formatPointOfSaleNumber(number: number): string {
  return String(number).padStart(5, '0')
}

// Same rules as backend/src/module/points-of-sale/points-of-sale.schemas.ts, with messages in Spanish.
export const pointOfSaleSchema = z.object({
  number: z
    .string()
    .trim()
    .regex(/^\d{1,5}$/, 'Ingresá un número de hasta 5 dígitos')
    .transform(Number)
    .refine((value) => value >= 1, 'El número tiene que ser mayor a 0'),
  address: optionalText(255),
})

export type PointOfSaleFormValues = z.input<typeof pointOfSaleSchema>
export type PointOfSaleInput = z.output<typeof pointOfSaleSchema>

/** Body of PATCH /api/points-of-sale/:id. */
export type PointOfSaleUpdate = Partial<PointOfSaleInput> & { isActive?: boolean }

export const pointOfSaleFields = [
  'number',
  'address',
] as const satisfies readonly (keyof PointOfSaleFormValues)[]
