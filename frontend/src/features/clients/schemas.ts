import { z } from 'zod'
import { isValidCuit, taxConditionLabels } from '@/features/organizations/schemas'
import type { TaxCondition } from '@/features/organizations/types'
import { optionalText } from '@/lib/schema-helpers'

export type DocType = 'CUIT' | 'CUIL' | 'DNI' | 'PASAPORTE' | 'SIN_IDENTIFICAR'

export const docTypeLabels: Record<DocType, string> = {
  CUIT: 'CUIT',
  CUIL: 'CUIL',
  DNI: 'DNI',
  PASAPORTE: 'Pasaporte',
  SIN_IDENTIFICAR: 'Sin identificar',
}

export { taxConditionLabels }

/** Client as the backend returns it (Prisma model, camelCase). */
export type Client = {
  id: number
  organizationId: number
  docType: DocType | null
  docNumber: string | null
  name: string
  address: string | null
  taxCondition: TaxCondition | null
  email: string | null
  phone: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type ClientFilters = {
  search?: string
  includeInactive?: boolean
}

const emptyToNull = <T extends string>(value: T | '') => (value === '' ? null : value)

export const clientSchema = z
  .object({
    name: z.string().trim().min(1, 'Ingresá el nombre o la razón social').max(255),
    docType: z
      .enum(['', 'CUIT', 'CUIL', 'DNI', 'PASAPORTE', 'SIN_IDENTIFICAR'])
      .transform(emptyToNull),
    docNumber: z
      .string()
      .transform((value) => value.replace(/[-.\s]/g, ''))
      .pipe(z.string().max(20, 'Hasta 20 caracteres'))
      .transform((value) => (value === '' ? null : value)),
    taxCondition: z
      .enum(['', 'RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO', 'CONSUMIDOR_FINAL'])
      .transform(emptyToNull),
    email: z
      .string()
      .trim()
      .refine((value) => value === '' || z.email().safeParse(value).success, 'Email inválido')
      .transform((value) => (value === '' ? null : value.toLowerCase())),
    phone: optionalText(50),
    address: optionalText(255),
  })
  .superRefine((values, ctx) => {
    const needsNumber = values.docType !== null && values.docType !== 'SIN_IDENTIFICAR'
    if (needsNumber && !values.docNumber) {
      ctx.addIssue({
        code: 'custom',
        path: ['docNumber'],
        message: 'Ingresá el número de documento',
      })
    }
    if (values.docNumber && values.docType === null) {
      ctx.addIssue({ code: 'custom', path: ['docType'], message: 'Elegí el tipo de documento' })
    }
    if (
      (values.docType === 'CUIT' || values.docType === 'CUIL') &&
      values.docNumber &&
      !isValidCuit(values.docNumber)
    ) {
      ctx.addIssue({ code: 'custom', path: ['docNumber'], message: 'El número no es válido' })
    }
  })

export type ClientFormValues = z.input<typeof clientSchema>
export type ClientInput = z.output<typeof clientSchema>

export const clientFields = [
  'name',
  'docType',
  'docNumber',
  'taxCondition',
  'email',
  'phone',
  'address',
] as const satisfies readonly (keyof ClientFormValues)[]
