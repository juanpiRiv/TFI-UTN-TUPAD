import { z } from "zod";
import { isValidCuit } from "../../lib/cuit.js";

export const createOrganizationSchema = z.object({
  cuit: z
    .string()
    .trim()
    .transform((val) => val.replace(/[-\s]/g, ""))
    .refine((val) => /^\d{11}$/.test(val), "El CUIT debe tener 11 dígitos")
    .refine(isValidCuit, "El CUIT no es válido (revisá el dígito verificador)"),
  legalName: z
    .string()
    .trim()
    .min(1, "Ingresá la razón social o tu nombre y apellido")
    .max(255, "Hasta 255 caracteres"),
  tradeName: z.string().trim().max(255).nullish(),
  commercialAddress: z.string().trim().max(255).nullish(),
  taxCondition: z
    .enum(["MONOTRIBUTO", "RESPONSABLE_INSCRIPTO", "EXENTO", "CONSUMIDOR_FINAL"])
    .default("MONOTRIBUTO"),
  monotributoCategory: z.string().trim().max(10).nullish(),
  activityStartDate: z
    .string()
    .nullish()
    .transform((val) => (val && val.trim() ? new Date(val) : null)),
  grossIncomeNumber: z.string().trim().max(50).nullish(),
  baseCurrency: z.enum(["ARS", "USD"]).default("ARS"),
});

export const updateOrganizationSchema = z.object({
  legalName: z.string().trim().min(1).max(255).optional(),
  tradeName: z.string().trim().max(255).nullish(),
  commercialAddress: z.string().trim().max(255).nullish(),
  taxCondition: z
    .enum(["MONOTRIBUTO", "RESPONSABLE_INSCRIPTO", "EXENTO", "CONSUMIDOR_FINAL"])
    .optional(),
  monotributoCategory: z.string().trim().max(10).nullish(),
  activityStartDate: z
    .string()
    .nullish()
    .transform((val) => (val && val.trim() ? new Date(val) : null)),
  grossIncomeNumber: z.string().trim().max(50).nullish(),
  baseCurrency: z.enum(["ARS", "USD"]).optional(),
});

export type CreateOrganizationInput = z.infer<typeof createOrganizationSchema>;
export type UpdateOrganizationInput = z.infer<typeof updateOrganizationSchema>;
