import { z } from 'zod'
import { optionalText } from '@/lib/schema-helpers'

export function createProfileSchema(currentEmail: string) {
  return z
    .object({
      name: optionalText(255, 'El nombre puede tener hasta 255 caracteres'),
      email: z.string().trim().toLowerCase().email('Ingresá un email válido').max(255),
      currentPassword: z.string(),
    })
    .superRefine((values, ctx) => {
      if (values.email !== currentEmail && !values.currentPassword) {
        ctx.addIssue({
          code: 'custom',
          path: ['currentPassword'],
          message: 'Para cambiar el email ingresá tu contraseña actual',
        })
      }
    })
    .transform(({ name, email, currentPassword }): UpdateProfileInput =>
      email === currentEmail ? { name } : { name, email, currentPassword },
    )
}

export const profileFields = ['name', 'email', 'currentPassword'] as const

export type ProfileFormValues = z.input<ReturnType<typeof createProfileSchema>>

export type UpdateProfileInput = {
  name: string | null
  email?: string
  currentPassword?: string
}

export const passwordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Ingresá tu contraseña actual'),
    newPassword: z
      .string()
      .min(8, 'La contraseña tiene que tener al menos 8 caracteres')
      .max(128, 'La contraseña puede tener hasta 128 caracteres'),
    confirmPassword: z.string(),
  })
  .refine((values) => values.newPassword === values.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Las contraseñas no coinciden',
  })
  .refine((values) => values.newPassword !== values.currentPassword, {
    path: ['newPassword'],
    message: 'La contraseña nueva tiene que ser distinta de la actual',
  })
  .transform(({ currentPassword, newPassword }) => ({ currentPassword, newPassword }))

export const passwordFields = ['currentPassword', 'newPassword', 'confirmPassword'] as const

export type PasswordFormValues = z.input<typeof passwordSchema>
export type ChangePasswordInput = z.output<typeof passwordSchema>
