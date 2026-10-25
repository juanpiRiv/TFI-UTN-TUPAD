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

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "La fecha debe tener formato AAAA-MM-DD")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "La fecha no es válida");

/** Número o texto numérico con una cantidad máxima de decimales. */
const decimalInput = (maxDecimals: number, label: string) =>
  z
    .union([z.number(), z.string().trim()])
    .refine((value) => value !== "" && Number.isFinite(Number(value)), `${label} debe ser un número`)
    .refine((value) => {
      const decimals = String(value).split(".")[1]?.length ?? 0;
      return decimals <= maxDecimals;
    }, `${label} admite hasta ${maxDecimals} decimales`)
    .refine((value) => Math.abs(Number(value)) < 1e12, `${label} es demasiado grande`);

export const invoiceItemSchema = z.object({
  description: z.string().trim().min(1, "La descripción es obligatoria").max(255, "Hasta 255 caracteres"),
  quantity: decimalInput(3, "La cantidad").refine((value) => Number(value) > 0, "La cantidad debe ser mayor a cero"),
  unitPrice: decimalInput(2, "El precio unitario").refine(
    (value) => Number(value) >= 0,
    "El precio unitario no puede ser negativo",
  ),
});

// En el P0 solo se emite Factura C en pesos (docs/04, regla 10). El total no se recibe: lo calcula el backend.
export const createInvoiceSchema = z
  .object({
    pointOfSaleId: z.number().int().positive().optional(),
    clientId: z.number().int().positive().nullish(),
    voucherType: z.literal("FACTURA_C").default("FACTURA_C"),
    concept: z.enum(["PRODUCTOS", "SERVICIOS", "PRODUCTOS_Y_SERVICIOS"]),
    issueDate: dateString,
    currency: z.literal("ARS").default("ARS"),
    serviceFrom: dateString.optional(),
    serviceTo: dateString.optional(),
    paymentDueDate: dateString.optional(),
    items: z.array(invoiceItemSchema).min(1, "La factura necesita al menos un ítem"),
  })
  .superRefine((data, ctx) => {
    if (data.concept === "PRODUCTOS") return;
    for (const field of ["serviceFrom", "serviceTo", "paymentDueDate"] as const) {
      if (!data[field]) {
        ctx.addIssue({
          code: "custom",
          path: [field],
          message: "Es obligatoria si el concepto incluye servicios",
        });
      }
    }
    if (data.serviceFrom && data.serviceTo && data.serviceTo < data.serviceFrom) {
      ctx.addIssue({ code: "custom", path: ["serviceTo"], message: "No puede ser anterior al inicio del servicio" });
    }
  });

export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>;
