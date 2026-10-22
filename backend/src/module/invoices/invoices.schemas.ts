import { z } from "zod";

export const invoiceIdParamSchema = z.object({
  invoiceId: z
    .string()
    .regex(/^\d+$/, "El ID de la factura debe ser un número entero")
    .transform((val) => Number(val))
    .refine((val) => Number.isInteger(val) && val > 0 && val <= 2147483647, {
      message: "El ID de la factura debe ser un entero positivo válido",
    }),
});
