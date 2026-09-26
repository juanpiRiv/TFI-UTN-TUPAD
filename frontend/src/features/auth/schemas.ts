import { z } from 'zod'
import type { Organization } from '@/features/organizations/types'

// Same rules as backend/src/module/auth/auth.schemas.ts, with messages in Spanish.
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().email('Ingresá un email válido'),
  password: z.string().min(1, 'Ingresá tu contraseña'),
})

export const registerSchema = z
  .object({
    email: z.string().trim().toLowerCase().email('Ingresá un email válido').max(255),
    password: z
      .string()
      .min(8, 'La contraseña tiene que tener al menos 8 caracteres')
      .max(128, 'La contraseña puede tener hasta 128 caracteres'),
    confirmPassword: z.string(),
  })
  .refine((values) => values.password === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Las contraseñas no coinciden',
  })

export type LoginInput = z.infer<typeof loginSchema>
export type RegisterFormValues = z.input<typeof registerSchema>
export type RegisterInput = Omit<z.output<typeof registerSchema>, 'confirmPassword'>

export type User = {
  id: number
  email: string
  createdAt: string
}

/** Response of POST /api/auth/register and POST /api/auth/login. */
export type AuthResponse = {
  user: User
  token: string
}

/** Response of GET /api/auth/me: the user plus its organization (null until onboarding). */
export type Me = User & {
  organization: Organization | null
}
