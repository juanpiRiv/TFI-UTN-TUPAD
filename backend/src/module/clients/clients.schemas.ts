import { z } from "zod";
import { DocType, TaxCondition } from "../../generated/prisma/client.js";

export const createClientSchema = z.object({
  name: z
    .string({ required_error: "Name is required" })
    .trim()
    .min(1, "Name is required")
    .max(255, "Name is too long"),
  docType: z.nativeEnum(DocType).nullable().optional(),
  docNumber: z
    .string()
    .trim()
    .max(20, "Document number cannot exceed 20 characters")
    .nullable()
    .optional()
    .transform((val) => (val === "" ? null : val)),
  taxCondition: z.nativeEnum(TaxCondition).nullable().optional(),
  email: z
    .string()
    .trim()
    .max(255, "Email is too long")
    .email("Invalid email")
    .toLowerCase()
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  phone: z
    .string()
    .trim()
    .max(50, "Phone cannot exceed 50 characters")
    .nullable()
    .optional(),
  address: z
    .string()
    .trim()
    .max(255, "Address cannot exceed 255 characters")
    .nullable()
    .optional(),
});

export const updateClientSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, "Name cannot be empty")
    .max(255, "Name is too long")
    .optional(),
  docType: z.nativeEnum(DocType).nullable().optional(),
  docNumber: z
    .string()
    .trim()
    .max(20, "Document number cannot exceed 20 characters")
    .nullable()
    .optional()
    .transform((val) => (val === "" ? null : val)),
  taxCondition: z.nativeEnum(TaxCondition).nullable().optional(),
  email: z
    .string()
    .trim()
    .max(255, "Email is too long")
    .email("Invalid email")
    .toLowerCase()
    .nullable()
    .optional()
    .or(z.literal("").transform(() => null)),
  phone: z
    .string()
    .trim()
    .max(50, "Phone cannot exceed 50 characters")
    .nullable()
    .optional(),
  address: z
    .string()
    .trim()
    .max(255, "Address cannot exceed 255 characters")
    .nullable()
    .optional(),
  isActive: z.boolean().optional(),
});

export const listClientsQuerySchema = z.object({
  search: z.string().trim().optional(),
  includeInactive: z
    .enum(["true", "false"])
    .optional()
    .transform((val) => val === "true"),
});

export type CreateClientInput = z.infer<typeof createClientSchema>;
export type UpdateClientInput = z.infer<typeof updateClientSchema>;
export type ListClientsQuery = z.infer<typeof listClientsQuerySchema>;
