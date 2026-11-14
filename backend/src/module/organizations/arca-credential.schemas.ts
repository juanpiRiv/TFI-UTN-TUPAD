import { z } from "zod";

// Un PEM de certificado o de clave RSA de 2048 bits pesa pocos KB: el tope evita pedidos desmedidos.
const pem = (label: string) =>
    z
        .string({ error: `${label} is required` })
        .trim()
        .min(1, `${label} is required`)
        .max(20_000, `${label} is too long`)
        .refine((value) => !value.includes("\u0000"), "Text contains invalid characters");

export const arcaCredentialSchema = z.object({
    certificate: pem("Certificate"),
    privateKey: pem("Private key"),
});
