import { z } from 'zod'
import { optionalText } from '@/lib/schema-helpers'
import type { TaxCondition } from './types'

export const taxConditionLabels: Record<TaxCondition, string> = {
  MONOTRIBUTO: 'Monotributo',
  RESPONSABLE_INSCRIPTO: 'Responsable inscripto',
  EXENTO: 'Exento',
  CONSUMIDOR_FINAL: 'Consumidor final',
}

const CUIT_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]

/** Validates the CUIT check digit (11 digits, without dashes). */
export function isValidCuit(cuit: string): boolean {
  if (!/^\d{11}$/.test(cuit)) return false
  const digits = cuit.split('').map(Number)
  const sum = CUIT_WEIGHTS.reduce(
    (total, weight, index) => total + weight * (digits[index] ?? 0),
    0,
  )
  const remainder = 11 - (sum % 11)
  const expected = remainder === 11 ? 0 : remainder
  return expected !== 10 && expected === digits[10]
}

export const organizationSchema = z.object({
  cuit: z
    .string()
    .transform((value) => value.replace(/[-\s]/g, ''))
    .refine((value) => /^\d{11}$/.test(value), 'El CUIT tiene 11 números')
    .refine(isValidCuit, 'El CUIT no es válido (revisá el dígito verificador)'),
  legalName: z
    .string()
    .trim()
    .min(1, 'Ingresá la razón social o tu nombre y apellido')
    .max(255, 'Hasta 255 caracteres'),
  tradeName: optionalText(255),
  commercialAddress: optionalText(255),
  // P0 profile: monotributista. The other values exist in the backend enum.
  taxCondition: z.enum(['MONOTRIBUTO', 'RESPONSABLE_INSCRIPTO', 'EXENTO', 'CONSUMIDOR_FINAL']),
  monotributoCategory: optionalText(10),
  activityStartDate: z
    .string()
    .transform((value) => (value === '' ? null : value))
    .refine((value) => value === null || /^\d{4}-\d{2}-\d{2}$/.test(value), 'Fecha inválida'),
  grossIncomeNumber: optionalText(50),
  baseCurrency: z.enum(['ARS', 'USD'], { error: 'Elegí la moneda base' }),
})

export type OrganizationFormValues = z.input<typeof organizationSchema>
export type OrganizationInput = z.output<typeof organizationSchema>

export const organizationFields = [
  'cuit',
  'legalName',
  'tradeName',
  'commercialAddress',
  'taxCondition',
  'monotributoCategory',
  'activityStartDate',
  'grossIncomeNumber',
  'baseCurrency',
] as const satisfies readonly (keyof OrganizationFormValues)[]
