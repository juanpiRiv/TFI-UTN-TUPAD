import { z } from "zod";
import { isoDate } from "../../lib/date.js";

const positiveDecimal2 = /^\d{1,12}(\.\d{1,2})?$/;
const positiveDecimal6 = /^\d{1,10}(\.\d{1,6})?$/;

/**
 * Esquema de validación para registrar un pago contra una factura.
 * Cumple RN-03, RN-04, RN-05 y F1-5 / F6-7.
 */
export const createPaymentSchema = z.object({
  amount: z
    .string({ error: "El importe es requerido" })
    .trim()
    .refine((val) => positiveDecimal2.test(val) && Number(val) > 0, {
      message: "El importe debe ser mayor a cero y con hasta 2 decimales",
    }),
  paymentDate: isoDate,
  currency: z.enum(["ARS", "USD"]).default("ARS"),
  exchangeRate: z
    .string()
    .trim()
    .refine((val) => positiveDecimal6.test(val) && Number(val) > 0, {
      message: "El tipo de cambio debe ser mayor a cero y con hasta 6 decimales",
    })
    .optional()
    .nullable()
    .or(z.literal("").transform(() => null)),
  description: z.string().trim().max(255).optional().nullable(),
  adoptTransactionId: z.coerce
    .number()
    .int("El ID de movimiento debe ser un entero")
    .positive("El ID de movimiento debe ser un entero positivo")
    .max(2147483647, "ID de movimiento fuera de rango")
    .optional()
    .nullable(),
});

export const invoiceIdParamSchema = z.object({
  invoiceId: z.coerce
    .number({ error: "El ID de factura debe ser un número" })
    .int("El ID de factura debe ser un entero")
    .positive("El ID de factura debe ser un entero positivo")
    .max(2147483647, "ID de factura fuera de rango"),
});

export type CreatePaymentInput = z.infer<typeof createPaymentSchema>;
