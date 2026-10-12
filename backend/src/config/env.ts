import path from "node:path";
import dotenv from "dotenv";
import { z } from "zod";

dotenv.config();
dotenv.config({ path: path.resolve(process.cwd(), "backend", ".env") });

const schema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
    // Orígenes permitidos separados por coma. Vacío = abierto (solo dev).
    CORS_ORIGIN: z.string().optional()
});

export const env = schema.parse(process.env);