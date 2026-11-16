import { z } from "zod";

const schema = z.object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    PORT: z.coerce.number().default(3000),
    DATABASE_URL: z.string().url(),
    JWT_SECRET: z.string().min(32),
    // Orígenes permitidos separados por coma. Vacío = abierto (solo dev).
    CORS_ORIGIN: z.string().optional(),
    // Qué proveedor fiscal usa el backend (simulated, sdk o direct). Se valida al arrancar el servidor
    // (server.ts) y no acá, para que los tests que importan la app no la necesiten.
    ARCA_PROVIDER: z.string().optional(),
    // Ambiente de ARCA: homologación por defecto, producción solo de forma explícita.
    ARCA_MODE: z.enum(["homologacion", "produccion"]).default("homologacion"),
    // Credenciales de prueba para ARCA_PROVIDER=sdk (ver module/arca/credentials-from-env.ts). Se validan
    // al construir el proveedor y no acá, para que los tests y los otros proveedores no las necesiten.
    ARCA_CUIT: z.string().optional(),
    ARCA_CERT_PATH: z.string().optional(),
    ARCA_KEY_PATH: z.string().optional(),
    ARCA_CERT_PEM: z.string().optional(),
    ARCA_KEY_PEM: z.string().optional(),
    // Clave para cifrar la clave privada de ARCA de cada organización: 64 caracteres hexadecimales (openssl rand -hex 32).
    ARCA_ENCRYPTION_KEY: z.string().optional(),
    // Carpeta donde se comparte el ticket de acceso de WSAA entre procesos (ver FileWsaaSessionStore).
    ARCA_SESSION_DIR: z.string().optional(),
    // Con el proveedor sdk, producción solo se habilita escribiendo exactamente "true".
    ARCA_ALLOW_PRODUCTION: z.string().optional(),
    // Modo delegado: la plataforma firma con su certificado (ARCA_CUIT y el certificado de arriba) y emite en nombre de
    // cada cliente que le delegó el servicio de facturación. Solo se habilita escribiendo exactamente "true".
    ARCA_DELEGATION: z.string().optional(),
    // Correos (separados por coma) de quienes pueden registrar la organización con el CUIT de la plataforma (ARCA_CUIT).
    // Vacío = nadie: el certificado de la plataforma no se puede usar registrando ese CUIT.
    ARCA_PLATFORM_OWNER_EMAILS: z.string().optional()
});

export const env = schema.parse(process.env);