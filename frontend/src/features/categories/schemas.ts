import { z } from 'zod'

export type MovementType = 'INCOME' | 'EXPENSE'

export const movementTypeLabels: Record<MovementType, string> = {
  INCOME: 'Ingreso',
  EXPENSE: 'Egreso',
}

/** Category as the backend returns it (Prisma model, camelCase). */
export type Category = {
  id: number
  organizationId: number
  name: string
  type: MovementType
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type CategoryFilters = {
  type?: MovementType
  includeInactive?: boolean
}

// A category is either INCOME or EXPENSE (docs/03-modelo-de-datos.md), never both.
export const categorySchema = z.object({
  name: z.string().trim().min(1, 'Ingresá un nombre').max(100, 'Hasta 100 caracteres'),
  type: z.enum(['INCOME', 'EXPENSE'], { error: 'Elegí si es de ingreso o de egreso' }),
})

export type CategoryInput = z.infer<typeof categorySchema>

export const categoryFields = ['name', 'type'] as const satisfies readonly (keyof CategoryInput)[]
