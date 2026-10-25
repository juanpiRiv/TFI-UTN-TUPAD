import { z } from "zod";
import { isValidCuit } from "../../lib/cuit.js";
import { isoDate } from "../../lib/date.js";

// Postgres rechaza el carácter nulo en columnas de texto: sin esto, la base tira un 500
const noNullChar = (value: string) => !value.includes("\u0000");
const NULL_CHAR_MESSAGE = "Text contains invalid characters";

/** Texto opcional: "" o null se guardan como null. */
const optionalText = (max: number) =>
    z
        .string()
        .trim()
        .max(max)
        .refine(noNullChar, NULL_CHAR_MESSAGE)
        .transform((value) => (value === "" ? null : value))
        .nullable()
        .optional();

const cuit = z
    .string()
    .transform((value) => value.replace(/[-\s]/g, ""))
    .refine((value) => /^\d{11}$/.test(value), "CUIT must have 11 digits")
    .refine(isValidCuit, "Invalid CUIT");

// CONSUMIDOR_FINAL no va: es una condición del receptor de la factura, no del emisor
const taxCondition = z.enum(["MONOTRIBUTO", "RESPONSABLE_INSCRIPTO", "EXENTO"]);

// P0: la moneda base es siempre ARS (issue #96; las facturas van en ARS, docs/04)
const baseCurrency = z.literal("ARS", { error: "Base currency must be ARS" });

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

const MIN_ACTIVITY_START = "1900-01-01";
const todayIso = () => new Date().toISOString().slice(0, 10);

const activityStartDate = z
    .string()
    .trim()
    .refine((value) => value === "" || isoDate.safeParse(value).success, {
        message: "Invalid date (expected YYYY-MM-DD)",
        abort: true,
    })
    .refine((value) => value === "" || value >= MIN_ACTIVITY_START, {
        message: `Activity start date must be ${MIN_ACTIVITY_START} or later`,
    })
    .refine((value) => value === "" || value <= todayIso(), {
        message: "Activity start date cannot be in the future",
    })
    .transform((value) => (value === "" ? null : new Date(`${value}T00:00:00.000Z`)))
    .nullable()
    .optional();

const organizationFields = z.object({
    cuit,
    legalName: z
        .string()
        .trim()
        .min(1, "Legal name is required")
        .max(255)
        .refine(noNullChar, NULL_CHAR_MESSAGE),
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