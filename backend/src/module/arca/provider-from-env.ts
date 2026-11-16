import type { FiscalProvider } from './fiscal-provider.js'
import { loadArcaCredentialsFromEnv, type ArcaCredentialEnv } from './credentials-from-env.js'
import { createFiscalProvider, parseArcaProviderKind, type ArcaMode } from './provider-factory.js'
import type { ArcaWsaaSessionStore } from 'facturas'
import { createWsaaSessionStore, defaultSessionDir } from './wsaa-store-factory.js'

export { defaultSessionDir }

export interface FiscalProviderEnv extends ArcaCredentialEnv {
  ARCA_PROVIDER?: string | undefined
  ARCA_MODE: ArcaMode
  /** Hay que escribir exactamente "true" para permitir producción. Cualquier otro valor la bloquea. */
  ARCA_ALLOW_PRODUCTION?: string | undefined
  /** Carpeta del ticket de acceso compartido. Por defecto ~/.arca-homologacion/sessions. */
  ARCA_SESSION_DIR?: string | undefined
}

// Un solo cliente sdk por proceso: así se reutiliza el ticket de acceso de WSAA, que dura 12 horas
// y ARCA no deja pedir otro mientras el anterior sigue vigente.
let cachedSdkProvider: FiscalProvider | undefined

/**
 * Devuelve el proveedor fiscal que corresponde al entorno. Con `sdk` toma el CUIT, el certificado y
 * la clave de las variables ARCA_*: es el camino de prueba contra homologación. El camino por
 * organización (tabla ArcaCredential) todavía no existe.
 */
export function getFiscalProviderFromEnv(
  env: FiscalProviderEnv & { ARCA_ENCRYPTION_KEY?: string | undefined },
  /** Almacén del ticket. Sin él se usa el archivo: los scripts no tienen base de datos. */
  wsaaSessionStore?: ArcaWsaaSessionStore,
): FiscalProvider {
  const kind = parseArcaProviderKind(env.ARCA_PROVIDER)
  if (kind !== 'sdk') {
    return createFiscalProvider(kind, { mode: env.ARCA_MODE })
  }
  cachedSdkProvider ??= createFiscalProvider('sdk', {
    mode: env.ARCA_MODE,
    credentials: loadArcaCredentialsFromEnv(env),
    allowProduction: env.ARCA_ALLOW_PRODUCTION === 'true',
    overrides: { wsaaSessionStore: wsaaSessionStore ?? createWsaaSessionStore(env) },
  })
  return cachedSdkProvider
}

/** Solo para tests: olvida el cliente guardado. */
export function resetFiscalProviderCache(): void {
  cachedSdkProvider = undefined
}
