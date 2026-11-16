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
import { isPlatformOwnerEmail, type PlatformOwnerEnv } from './platform-owner.js'
import { environmentOf, getDelegatedProvider, loadDelegationForOrganization, loadPlatformCredentials, type DelegationEnv, type StoredDelegation } from './delegation-platform.js'

export interface OrganizationProviderEnv extends FiscalProviderEnv, Pick<DelegationEnv, 'ARCA_DELEGATION'>, Pick<PlatformOwnerEnv, 'NODE_ENV' | 'ARCA_PLATFORM_OWNER_EMAILS'> {
  ARCA_ENCRYPTION_KEY?: string | undefined
}

export interface OrganizationProviderDeps {
  loadCredentials?: (org: { id: number; cuit: string }, encryptionKeyHex: string | undefined) => Promise<StoredArcaCredentials | null>
  /** Si el usuario de la organización está en ARCA_PLATFORM_OWNER_EMAILS. Solo se consulta en producción. */
  isPlatformOwner?: (org: { id: number; cuit: string }, env: OrganizationProviderEnv) => Promise<boolean>
  loadDelegation?: (org: { id: number; cuit: string }) => Promise<StoredDelegation | null>
}

/**
 * Proveedor fiscal que corresponde a una organización.
 *  - `simulated`: el simulador, para desarrollo y demo.
 *  - `sdk`: ARCA de verdad. En este orden de prioridad:
 *      1. la credencial propia que la organización cargó;
 *      2. el modo delegado (ARCA_DELEGATION=true): el certificado de la plataforma, solo si la organización tiene una
 *         delegación verificada en este ambiente;
 *      3. las variables ARCA_* (camino de desarrollo), solo si el CUIT de la organización es el de esas variables;
 *      4. si no, falla con un mensaje claro en vez de emitir con el simulador o con el certificado de otro CUIT.
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
      throw new ProviderUnavailableError(
        'La credencial cargada es de homologación y el servidor está configurado en producción.',
        'La conexión con ARCA que cargaste es de pruebas y no sirve para facturar con validez fiscal. Conectá una de producción.',
      )
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

  const delegated = await loadDelegated(env, org, deps)
  if (delegated) return delegated

  // Las variables ARCA_* firman por su propio CUIT: solo sirven a la organización que tiene ese CUIT. En producción,
  // además, solo si su usuario es uno de los dueños de la plataforma: el CUIT lo puede registrar cualquiera.
  if (env.ARCA_CUIT?.trim() === org.cuit && (await mayUsePlatformCuit(env, org, deps))) return getFiscalProviderFromEnv(env, createWsaaSessionStore(env, prisma))
  throw new ProviderUnavailableError(
    'La organización todavía no cargó su credencial de ARCA. Se carga en la pantalla de la organización.',
    'Todavía no conectaste tu cuenta con ARCA. Hacelo en «Mi negocio» y volvé a facturar.',
  )
}

async function mayUsePlatformCuit(env: OrganizationProviderEnv, org: { id: number; cuit: string }, deps: OrganizationProviderDeps): Promise<boolean> {
  if (env.NODE_ENV !== 'production') return true
  const check =
    deps.isPlatformOwner ??
    (async (o: { id: number }, e: OrganizationProviderEnv) => {
      const owner = await prisma.organization.findUnique({ where: { id: o.id }, select: { user: { select: { email: true } } } })
      return isPlatformOwnerEmail(e, owner?.user.email)
    })
  return check(org, env)
}

/** Proveedor del modo delegado, o null si no corresponde (apagado, sin plataforma, sin delegación verificada en este ambiente). */
async function loadDelegated(env: OrganizationProviderEnv, org: { id: number; cuit: string }, deps: OrganizationProviderDeps): Promise<FiscalProvider | null> {
  const platform = loadPlatformCredentials(env)
  if (!platform) return null
  // Si la organización es la dueña del certificado no hay nada que delegar: sigue el camino de las variables.
  if (platform.credentials.cuit === org.cuit) return null
  let row: StoredDelegation | null
  try {
    row = await (deps.loadDelegation ?? loadDelegationForOrganization)(org)
  } catch (error) {
    if (error instanceof ProviderUnavailableError) throw error
    console.error(`[arca] no se pudo leer la delegación de la organización ${org.id}: ${error instanceof Error ? error.name : 'Error'}`)
    throw new ProviderUnavailableError('No se pudo leer la delegación de ARCA de la organización.')
  }
  // Una delegación verificada en homologación no vale en producción, ni al revés.
  // Tampoco vale si el CUIT de la organización cambió desde que se verificó.
  if (!row || row.status !== 'VERIFIED' || row.environment !== environmentOf(env) || row.verifiedCuit !== org.cuit) return null
  return getDelegatedProvider(env, org, platform)
}

/** Lee la credencial guardada. Un error de la base no se muestra al usuario: se registra y se informa de forma genérica. */
async function loadStored(env: OrganizationProviderEnv, org: { id: number; cuit: string }, deps: OrganizationProviderDeps) {
  const load = deps.loadCredentials ?? loadArcaCredentialsForOrganization
  try {
    return await load(org, env.ARCA_ENCRYPTION_KEY)
  } catch (error) {
    if (error instanceof CredentialError) throw new ProviderUnavailableError(error.message, error.message)
    if (error instanceof EncryptionKeyError) throw new ProviderUnavailableError(error.message)
    if (error instanceof Error && error.message.startsWith('No se pudo descifrar')) {
      throw new ProviderUnavailableError(error.message, 'No se pudo usar la conexión con ARCA guardada. Volvé a conectarla en «Mi negocio».')
    }
    console.error(`[arca] no se pudo leer la credencial de la organización ${org.id}: ${error instanceof Error ? error.name : 'Error'}`)
    throw new ProviderUnavailableError('No se pudo leer la credencial de ARCA de la organización.')
  }
}

/** Solo para tests. */
export function resetOrganizationProviders(): void {
  clearProviderCache()
}
