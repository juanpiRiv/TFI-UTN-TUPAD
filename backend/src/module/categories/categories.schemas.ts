import { z } from "zod";

export const createCategorySchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio").max(100, "Hasta 100 caracteres"),
  type: z.enum(["INCOME", "EXPENSE"]),
});

export const updateCategorySchema = z.object({
  name: z.string().trim().min(1, "El nombre no puede estar vacío").max(100, "Hasta 100 caracteres").optional(),
  isActive: z.boolean().optional(),
});

export const listCategoriesQuerySchema = z.object({
  type: z.enum(["INCOME", "EXPENSE"]).optional(),
  includeInactive: z
    .union([z.string(), z.boolean()])
    .optional()
    .transform((val) => val === true || val === "true"),
});

export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
export type UpdateCategoryInput = z.infer<typeof updateCategorySchema>;
export type ListCategoriesQuery = z.infer<typeof listCategoriesQuerySchema>;
