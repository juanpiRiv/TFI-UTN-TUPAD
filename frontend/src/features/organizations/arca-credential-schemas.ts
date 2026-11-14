import { z } from 'zod'

export const arcaCredentialSchema = z.object({
  certificate: z
    .string()
    .trim()
    .refine((value) => value.includes('BEGIN CERTIFICATE'), {
      message: 'El certificado tiene que ser un archivo PEM (debe incluir BEGIN CERTIFICATE)',
    }),
  privateKey: z
    .string()
    .trim()
    .refine((value) => value.includes('PRIVATE KEY'), {
      message: 'La clave tiene que ser un archivo PEM (debe incluir PRIVATE KEY)',
    })
    .refine((value) => !value.includes('ENCRYPTED'), {
      message: 'La clave está protegida con contraseña: generá una sin contraseña',
    }),
})

export type ArcaCredentialInput = z.infer<typeof arcaCredentialSchema>
export type ArcaCredentialFormValues = z.input<typeof arcaCredentialSchema>
