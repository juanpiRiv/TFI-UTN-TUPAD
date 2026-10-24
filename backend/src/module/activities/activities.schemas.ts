import { z } from "zod";

// Productos, servicios o ambas (criterio de cierre del issue #26)
const kind = z.enum(["GOODS", "SERVICES", "BOTH"], {
    error: "Kind must be GOODS, SERVICES or BOTH",
});

// Código del nomenclador de actividades de ARCA (CLAE): 6 dígitos. Opcional.
const arcaActivityCode = z
    .string()
    .trim()
    .transform((value) => (value === "" ? null : value))
    .refine((value) => value === null || /^\d{6}$/.test(value), {
        message: "ARCA activity code must have 6 digits",
    })
    .nullable()
    .optional();

const activityFields = z.object({
    description: z.string().trim().min(1, "Description is required").max(255),
    kind,
    arcaActivityCode,
    isPrimary: z.boolean().optional(),
});

export const createActivitySchema = activityFields;

export const updateActivitySchema = activityFields.partial().extend({
    isActive: z.boolean().optional(),
});

export const listActivitiesQuerySchema = z.object({
    includeInactive: z
        .enum(["true", "false"])
        .optional()
        .transform((value) => value === "true"),
});

export const activityIdParamSchema = z.object({
    id: z.coerce.number().int().positive().max(2_147_483_647),
});

export type CreateActivityInput = z.output<typeof createActivitySchema>;
export type UpdateActivityInput = z.output<typeof updateActivitySchema>;
export type ListActivitiesQuery = z.output<typeof listActivitiesQuerySchema>;