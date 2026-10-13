import { z } from "zod";

/**
 * Esquema de validación para registrar un pago contra una factura.
 * Cumple RN-03, RN-04, RN-05 y F1-5 / F6-7.
 */
export const createPaymentSchema = z.object({
  amount: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/, "El importe debe ser un número positivo con hasta 2 decimales")
    .refine((val) => Number(val) > 0, "El importe debe ser mayor a cero"),
  paymentDate: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha de pago debe tener formato YYYY-MM-DD"),
  currency: z.enum(["ARS", "USD"]).default("ARS"),
  exchangeRate: z
    .string()
    .regex(/^\d+(\.\d{1,6})?$/, "El tipo de cambio debe tener hasta 6 decimales")
    .optional()
    .nullable(),
  description: z.string().max(255).optional().nullable(),
  adoptTransactionId: z.number().int().positive().optional().nullable(),
});

export const invoiceIdParamSchema = z.object({
  invoiceId: z.coerce.number().int().positive("El ID de factura debe ser un entero positivo"),
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
