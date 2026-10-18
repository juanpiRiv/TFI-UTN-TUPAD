import { z } from "zod";
import { isValidCuit } from "../../lib/cuit.js";
import { isoDate } from "../../lib/date.js";


const optionalText = (max: number) =>
    z
        .string()
        .trim()
        .max(max)
        .transform((value) => (value === "" ? null : value))
        .nullable()
        .optional();

const cuit = z
    .string()
    .transform((value) => value.replace(/[-\s]/g, ""))
    .refine((value) => /^\d{11}$/.test(value), "CUIT must have 11 digits")
    .refine(isValidCuit, "Invalid CUIT");

const taxCondition = z.enum(["MONOTRIBUTO", "RESPONSABLE_INSCRIPTO", "EXENTO", "CONSUMIDOR_FINAL"]);

// Obligatoria: no acepta null ni "" (criterio de cierre del issue #25)
const baseCurrency = z.enum(["ARS", "USD"], { error: "Base currency is required" });

const monotributoCategory = z
    .string()
    .trim()
    .toUpperCase()
    .transform((value) => (value === "" ? null : value))
    .refine((value) => value === null || /^[A-K]$/.test(value), {
        message: "Monotributo category must be a letter from A to K",
    })
    .nullable()
    .optional();

const activityStartDate = z
    .union([z.literal(""), isoDate])
    .transform((value) => (value === "" ? null : new Date(`${value}T00:00:00.000Z`)))
    .nullable()
    .optional();

const organizationFields = z.object({
    cuit,
    legalName: z.string().trim().min(1, "Legal name is required").max(255),
    tradeName: optionalText(255),
    commercialAddress: optionalText(255),
    taxCondition,
    monotributoCategory,
    activityStartDate,
    grossIncomeNumber: optionalText(50),
    baseCurrency,
});

export const createOrganizationSchema = organizationFields;

// PATCH: cualquier campo del alta; los que no vienen no se tocan
export const updateOrganizationSchema = organizationFields.partial();

export type CreateOrganizationInput = z.output<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.output<typeof updateOrganizationSchema>;