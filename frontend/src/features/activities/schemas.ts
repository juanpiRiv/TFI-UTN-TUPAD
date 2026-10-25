import { z } from 'zod'
import { optionalText } from '@/lib/schema-helpers'

export type ActivityKind = 'GOODS' | 'SERVICES' | 'BOTH'

export const activityKindLabels: Record<ActivityKind, string> = {
  GOODS: 'Productos',
  SERVICES: 'Servicios',
  BOTH: 'Productos y servicios',
}

/** Activity as the backend returns it (Prisma model, camelCase). */
export type Activity = {
  id: number
  organizationId: number
  arcaActivityCode: string | null
  description: string
  kind: ActivityKind
  isPrimary: boolean
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type ActivityFilters = { includeInactive?: boolean }

// Same rules as backend/src/module/activities/activities.schemas.ts, with messages in Spanish.
export const activitySchema = z.object({
  description: z.string().trim().min(1, 'Ingresá una descripción').max(255, 'Hasta 255 caracteres'),
  kind: z.enum(['GOODS', 'SERVICES', 'BOTH'], { error: 'Elegí qué vendés con esta actividad' }),
  arcaActivityCode: optionalText(6, 'El código tiene 6 números').refine(
    (value) => value === null || /^\d{6}$/.test(value),
    'El código tiene 6 números',
  ),
})

export type ActivityFormValues = z.input<typeof activitySchema>
export type ActivityInput = z.output<typeof activitySchema>

/** Body of PATCH /api/activities/:id. */
export type ActivityUpdate = Partial<ActivityInput> & { isPrimary?: boolean; isActive?: boolean }

export const activityFields = [
  'description',
  'kind',
  'arcaActivityCode',
] as const satisfies readonly (keyof ActivityFormValues)[]
