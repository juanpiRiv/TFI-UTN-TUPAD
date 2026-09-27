import { z } from "zod";
export const registerSchema = z.object({
    email: z
        .string()
        .trim()
        .toLowerCase()
        .email("Invalid Email")
        .max(255),
    password: z
        .string()
        .min(8, "Password must have at least 8 digits")
        .max(128),
});

export const loginSchema = z.object({
    email: z.string().trim().toLowerCase().email("Invalid Email"),
    password: z.string().min(1, "Require password"),
});

export type RegisterInput = z.infer<typeof registerSchema>;
export type LoginInput = z.infer<typeof loginSchema>;