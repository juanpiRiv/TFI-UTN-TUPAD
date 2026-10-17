import { z } from "zod";
import { MovementType, Currency } from "../../generated/prisma/client.js";
import { isoDate } from "../../lib/date.js";

const positiveDecimal2 = /^\d{1,16}(\.\d{1,2})?$/;
const positiveDecimal6 = /^\d{1,12}(\.\d{1,6})?$/;

export const createTransactionSchema = z.object({
  type: z.nativeEnum(MovementType, { error: "El tipo de movimiento es requerido (INCOME o EXPENSE)" }),
  amount: z
    .string({ error: "El importe es requerido" })
    .trim()
    .refine((val) => positiveDecimal2.test(val) && Number(val) > 0, {
      message: "El importe debe ser mayor a cero y con hasta 2 decimales",
    }),
  currency: z.nativeEnum(Currency, { error: "La moneda es requerida (ARS o USD)" }),
  exchangeRate: z
    .string()
    .trim()
    .refine((val) => positiveDecimal6.test(val) && Number(val) > 0, {
      message: "El tipo de cambio debe ser mayor a cero y con hasta 6 decimales",
    })
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  categoryId: z.coerce
    .number({ error: "La categoría es requerida" })
    .int()
    .positive("ID de categoría inválido")
    .max(2147483647, "ID de categoría fuera de rango"),
  clientId: z.coerce
    .number()
    .int()
    .positive("ID de cliente inválido")
    .max(2147483647, "ID de cliente fuera de rango")
    .nullable()
    .optional(),
  transactionDate: isoDate,
  description: z
    .string()
    .trim()
    .max(255, "La descripción no puede superar 255 caracteres")
    .nullable()
    .optional()
    .transform((val) => (val === "" ? null : val)),
});

export const listTransactionsQuerySchema = z
  .object({
    from: isoDate.optional(),
    to: isoDate.optional(),
    type: z.nativeEnum(MovementType).optional(),
    categoryId: z.coerce.number().int().positive().max(2147483647).optional(),
    clientId: z.coerce.number().int().positive().max(2147483647).optional(),
    limit: z.coerce.number().int().positive().max(100).default(50).optional(),
  })
  .refine(
    (data) => {
      if (data.from && data.to) {
        return data.from <= data.to;
      }
      return true;
    },
    {
      message: "'from' no puede ser posterior a 'to'",
      path: ["from"],
    },
  );

export type CreateTransactionInput = z.infer<typeof createTransactionSchema>;
export type ListTransactionsQuery = z.infer<typeof listTransactionsQuerySchema>;
