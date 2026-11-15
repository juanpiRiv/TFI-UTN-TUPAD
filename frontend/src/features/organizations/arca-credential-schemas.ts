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

/** Wizard step 3: only the certificate. The private key never leaves the server. */
export const arcaCertificateSchema = z.object({
  certificate: z
    .string()
    .trim()
    .refine((value) => value.includes('BEGIN CERTIFICATE'), {
      message: 'El certificado tiene que ser un archivo PEM (debe incluir BEGIN CERTIFICATE)',
    }),
})

export type ArcaCertificateInput = z.infer<typeof arcaCertificateSchema>
export type ArcaCertificateFormValues = z.input<typeof arcaCertificateSchema>
