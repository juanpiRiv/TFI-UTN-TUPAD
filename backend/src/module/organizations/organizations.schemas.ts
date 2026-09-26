import { z } from "zod";
import { isValidCuit } from "../../lib/cuit.js";

const MONOTRIBUTO_CATEGORIES = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K"] as const;

const currency = z.enum(["ARS", "USD"]);

const dateOnly = z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, "Formato de fecha esperado: AAAA-MM-DD")
    .transform((value) => new Date(value));

const organizationFields = z.object({
    legalName: z.string().trim().min(1, "La razón social es obligatoria").max(255),
    tradeName: z.string().trim().max(255).optional(),
    commercialAddress: z.string().trim().max(255).optional(),
    monotributoCategory: z.enum(MONOTRIBUTO_CATEGORIES).optional(),
    activityStartDate: dateOnly.optional(),
    grossIncomeNumber: z.string().trim().max(50).optional(),
    baseCurrency: currency,
});

export const createOrganizationSchema = organizationFields.extend({
    cuit: z
        .string()
        .trim()
        .regex(/^\d{11}$/, "El CUIT debe tener 11 dígitos, sin guiones")
        .refine(isValidCuit, "El CUIT no es válido"),
    baseCurrency: currency.default("ARS"),
});

// El CUIT no se puede modificar: es la identidad fiscal de los comprobantes ya emitidos
export const updateOrganizationSchema = organizationFields.partial();

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;