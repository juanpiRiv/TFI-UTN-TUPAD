import { z } from 'zod'

/** A certificate (.crt) weighs about 2 KB: anything this big is not one. */
export const MAX_PEM_BYTES = 64 * 1024

const certificateField = z
  .string()
  .trim()
  .min(1, 'Pegá o subí el certificado')
  .refine((value) => !value.includes('PRIVATE KEY'), {
    message: 'Eso es una clave privada. Pegá solo el certificado (.crt).',
  })
  .refine((value) => value.includes('BEGIN CERTIFICATE'), {
    message: 'El certificado tiene que ser un archivo PEM (debe incluir BEGIN CERTIFICATE)',
  })

export const arcaCredentialSchema = z.object({
  certificate: certificateField,
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
  certificate: certificateField,
})

export type ArcaCertificateInput = z.infer<typeof arcaCertificateSchema>
export type ArcaCertificateFormValues = z.input<typeof arcaCertificateSchema>
