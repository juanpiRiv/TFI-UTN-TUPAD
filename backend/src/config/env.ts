import { z } from "zod";

const schema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
    // Orígenes permitidos separados por coma. Vacío = abierto (solo dev).
    CORS_ORIGIN: z.string().optional()
});

export const env = schema.parse(process.env);