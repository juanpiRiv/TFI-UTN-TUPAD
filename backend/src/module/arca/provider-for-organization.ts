import type { FiscalProvider } from './fiscal-provider.js'
import { loadArcaCredentialsForOrganization, type StoredArcaCredentials } from './arca-credential.service.js'
import { createFiscalProvider, parseArcaProviderKind } from './provider-factory.js'
import { defaultSessionDir, getFiscalProviderFromEnv, type FiscalProviderEnv } from './provider-from-env.js'
import { FileWsaaSessionStore } from './sdk/wsaa-session-store.js'

export interface OrganizationProviderEnv extends FiscalProviderEnv {
  ARCA_ENCRYPTION_KEY?: string | undefined
}

export interface OrganizationProviderDeps {
  loadCredentials?: (org: { id: number; cuit: string }, encryptionKeyHex: string | undefined) => Promise<StoredArcaCredentials | null>
}

// Un cliente por organización y certificado: así se reutiliza el ticket de acceso de WSAA, y si la
// organización carga otro certificado se arma un cliente nuevo.
const providers = new Map<string, FiscalProvider>()

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
  const kind = parseArcaProviderKind(env.ARCA_PROVIDER)
  if (kind !== 'sdk') return createFiscalProvider(kind, { mode: env.ARCA_MODE })

  const load = deps.loadCredentials ?? loadArcaCredentialsForOrganization
  const stored = await load(org, env.ARCA_ENCRYPTION_KEY)
  if (stored) {
    const cacheKey = `${org.id}:${stored.fingerprint}`
    let provider = providers.get(cacheKey)
    if (!provider) {
      provider = createFiscalProvider('sdk', {
        mode: env.ARCA_MODE,
        credentials: stored.credentials,
        allowProduction: env.ARCA_ALLOW_PRODUCTION === 'true',
        overrides: { wsaaSessionStore: new FileWsaaSessionStore(defaultSessionDir(env)) },
      })
      providers.set(cacheKey, provider)
    }
    return provider
  }

  if (env.ARCA_CUIT?.trim()) return getFiscalProviderFromEnv(env)
  throw new Error('La organización todavía no cargó su credencial de ARCA. Se carga en la pantalla de la organización.')
}

/** Solo para tests. */
export function resetOrganizationProviders(): void {
  providers.clear()
}
