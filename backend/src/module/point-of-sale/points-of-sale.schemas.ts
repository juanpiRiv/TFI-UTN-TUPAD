import { z } from "zod";

// ARCA numera los puntos de venta con hasta 5 dígitos
const number = z.coerce
    .number({ error: "Point of sale number is required" })
    .int("Point of sale number must be an integer")
    .min(1, "Point of sale number must be between 1 and 99999")
    .max(99_999, "Point of sale number must be between 1 and 99999");

// Postgres rechaza el carácter nulo en columnas de texto
const address = z
    .string()
    .trim()
    .max(255)
    .refine((value) => !value.includes("\u0000"), "Text contains invalid characters")
    .transform((value) => (value === "" ? null : value))
    .nullable()
    .optional();

export const createPointOfSaleSchema = z.object({
    number,
    address,
});

// El método de facturación no se expone: en el P0 siempre es CAE (WSFEv1)
export const updatePointOfSaleSchema = z
    .object({
        number: number.optional(),
        address,
        isActive: z.boolean().optional(),
    })
    .refine(
        (data) => data.number !== undefined || data.address !== undefined || data.isActive !== undefined,
        { path: ["number"], message: "Nothing to update" },
    );

export const listPointsOfSaleQuerySchema = z.object({
    includeInactive: z
        .enum(["true", "false"])
        .optional()
        .transform((value) => value === "true"),
});

export const pointOfSaleIdParamSchema = z.object({
    id: z.coerce.number().int().positive().max(2_147_483_647),
});

export type CreatePointOfSaleInput = z.output<typeof createPointOfSaleSchema>;
export type UpdatePointOfSaleInput = z.output<typeof updatePointOfSaleSchema>;
export type ListPointsOfSaleQuery = z.output<typeof listPointsOfSaleQuerySchema>;