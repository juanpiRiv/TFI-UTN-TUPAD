import { z } from "zod";

export const updateProfileSchema = z
    .object({
        // null borra el nombre
        name: z.string().trim().min(1, "Name cannot be empty").max(255).nullable().optional(),
        email: z.string().trim().toLowerCase().email("Invalid Email").max(255).optional(),
        // Obligatoria solo si cambia el email (se valida en el service)
        currentPassword: z.string().min(1).optional(),
    })
    .refine((data) => data.name !== undefined || data.email !== undefined, {
        path: ["name"],
        message: "Nothing to update",
    });

export const changePasswordSchema = z
    .object({
        currentPassword: z.string().min(1, "Require current password"),
        newPassword: z
            .string()
            .min(8, "Password must have at least 8 digits")
            .max(128),
    })
    .refine((data) => data.newPassword !== data.currentPassword, {
        path: ["newPassword"],
        message: "New password must be different from the current one",
    });

export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;