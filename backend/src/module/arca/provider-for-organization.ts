import type { FiscalProvider } from './fiscal-provider.js'
import { loadArcaCredentialsForOrganization, type StoredArcaCredentials } from './arca-credential.service.js'
import { createFiscalProvider, parseArcaProviderKind } from './provider-factory.js'
import { getFiscalProviderFromEnv, type FiscalProviderEnv } from './provider-from-env.js'
import { createWsaaSessionStore } from './wsaa-store-factory.js'
import { prisma } from '../../lib/prisma.js'
import { ProviderUnavailableError } from './errors.js'
import { clearProviderCache, getCachedProvider, setCachedProvider } from './provider-cache.js'
import { CredentialError } from './credential-inspector.js'
import { EncryptionKeyError } from './secret-box.js'

export interface OrganizationProviderEnv extends FiscalProviderEnv {
  ARCA_ENCRYPTION_KEY?: string | undefined
}

export interface OrganizationProviderDeps {
  loadCredentials?: (org: { id: number; cuit: string }, encryptionKeyHex: string | undefined) => Promise<StoredArcaCredentials | null>
}

/**
 * Proveedor fiscal que corresponde a una organización.
 *  - `simulated`: el simulador, para desarrollo y demo.
 *  - `sdk`: ARCA de verdad con la credencial que la organización cargó. Si no cargó ninguna, se usan las
 *    variables ARCA_* (camino de desarrollo); si tampoco están, falla con un mensaje claro en vez de
 *    emitir con el simulador sin avisar.
 */
export async function getFiscalProviderForOrganization(
  env: OrganizationProviderEnv,
  org: { id: number; cuit: string },
  deps: OrganizationProviderDeps = {},
): Promise<FiscalProvider> {
  try {
    return await build(env, org, deps)
  } catch (error) {
    // Solo los errores propios (variables, producción bloqueada, PEM inválido) tienen un mensaje seguro.
    if (error instanceof ProviderUnavailableError) throw error
    console.error(`[arca] no se pudo armar el proveedor fiscal de la organización ${org.id}: ${error instanceof Error ? `${error.name}: ${error.message}` : 'error desconocido'}`)
    throw new ProviderUnavailableError('No se pudo preparar la conexión con ARCA. Revisá la configuración de ARCA del servidor.')
  }
}

async function build(env: OrganizationProviderEnv, org: { id: number; cuit: string }, deps: OrganizationProviderDeps): Promise<FiscalProvider> {
  const kind = parseArcaProviderKind(env.ARCA_PROVIDER)
  if (kind !== 'sdk') return createFiscalProvider(kind, { mode: env.ARCA_MODE })

  const stored = await loadStored(env, org, deps)
  if (stored) {
    // La credencial que se carga hoy es de homologación: no se la manda a producción.
    if (env.ARCA_MODE === 'produccion') {
      throw new ProviderUnavailableError('La credencial cargada es de homologación y el servidor está configurado en producción.')
    }
    let provider = getCachedProvider(org.id, stored.fingerprint)
    if (!provider) {
      provider = createFiscalProvider('sdk', {
        mode: env.ARCA_MODE,
        credentials: stored.credentials,
        allowProduction: env.ARCA_ALLOW_PRODUCTION === 'true',
        overrides: { wsaaSessionStore: createWsaaSessionStore(env, prisma) },
      })
      setCachedProvider(org.id, stored.fingerprint, provider)
    }
    return provider
  }

  if (env.ARCA_CUIT?.trim()) return getFiscalProviderFromEnv(env, createWsaaSessionStore(env, prisma))
  throw new ProviderUnavailableError('La organización todavía no cargó su credencial de ARCA. Se carga en la pantalla de la organización.')
}

/** Lee la credencial guardada. Un error de la base no se muestra al usuario: se registra y se informa de forma genérica. */
async function loadStored(env: OrganizationProviderEnv, org: { id: number; cuit: string }, deps: OrganizationProviderDeps) {
  const load = deps.loadCredentials ?? loadArcaCredentialsForOrganization
  try {
    return await load(org, env.ARCA_ENCRYPTION_KEY)
  } catch (error) {
    if (error instanceof CredentialError || error instanceof EncryptionKeyError) throw new ProviderUnavailableError(error.message)
    if (error instanceof Error && error.message.startsWith('No se pudo descifrar')) throw new ProviderUnavailableError(error.message)
    console.error(`[arca] no se pudo leer la credencial de la organización ${org.id}: ${error instanceof Error ? error.name : 'Error'}`)
    throw new ProviderUnavailableError('No se pudo leer la credencial de ARCA de la organización.')
  }
}

/** Solo para tests. */
export function resetOrganizationProviders(): void {
  clearProviderCache()
}
