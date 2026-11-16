import type { FiscalProvider } from './fiscal-provider.js'
import { loadArcaCredentialsFromEnv } from './credentials-from-env.js'
import { inspectCredential } from './credential-inspector.js'
import { createFiscalProvider, type ArcaCredentials } from './provider-factory.js'
import { createWsaaSessionStore } from './wsaa-store-factory.js'
import { getCachedProvider, setCachedProvider } from './provider-cache.js'
import { ProviderUnavailableError } from './errors.js'
import type { FiscalProviderEnv } from './provider-from-env.js'
import { prisma } from '../../lib/prisma.js'

/** Variables que gobiernan el modo delegado. Las credenciales son las ARCA_* de siempre: son las de la plataforma. */
export interface DelegationEnv extends FiscalProviderEnv {
  /** Hay que escribir exactamente "true" para habilitar el modo delegado. */
  ARCA_DELEGATION?: string | undefined
  ARCA_ENCRYPTION_KEY?: string | undefined
}

export interface PlatformCredentials {
  credentials: ArcaCredentials
  /** Huella del certificado de la plataforma: cambia cuando se rota. */
  fingerprint: string
}

export const isDelegationEnabled = (env: Pick<DelegationEnv, 'ARCA_DELEGATION'>) => env.ARCA_DELEGATION?.trim() === 'true'

/**
 * Credenciales de la plataforma, o null si el modo delegado no se puede ofrecer: está apagado, el proveedor no es
 * `sdk`, producción sin confirmar, o las variables ARCA_* faltan o no son válidas. El motivo se registra en el
 * servidor una sola vez por llamada y nunca llega al usuario.
 */
export function loadPlatformCredentials(env: DelegationEnv): PlatformCredentials | null {
  if (!isDelegationEnabled(env)) return null
  if (env.ARCA_PROVIDER?.trim() !== 'sdk') return null
  if (env.ARCA_MODE === 'produccion' && env.ARCA_ALLOW_PRODUCTION !== 'true') return null
  try {
    const credentials = loadArcaCredentialsFromEnv(env)
    const inspected = inspectCredential({ certificatePem: credentials.certificatePem, privateKeyPem: credentials.privateKeyPem, expectedCuit: credentials.cuit })
    return { credentials, fingerprint: inspected.fingerprint }
  } catch (error) {
    console.error(`[arca] el modo delegado no está disponible: ${error instanceof Error ? `${error.name}: ${error.message}` : 'error desconocido'}`)
    return null
  }
}

/**
 * Proveedor que firma con el certificado de la plataforma y emite en nombre de la organización (`representedCuit`).
 * Se cachea por organización, CUIT representado, huella del certificado y ambiente: así se reutiliza el ticket de WSAA
 * y un certificado rotado arma un cliente nuevo.
 */
export function getDelegatedProvider(env: DelegationEnv, org: { id: number; cuit: string }, platform: PlatformCredentials): FiscalProvider {
  const key = `delegated:${org.cuit}:${platform.fingerprint}:${env.ARCA_MODE}`
  let provider = getCachedProvider(org.id, key)
  if (!provider) {
    provider = createFiscalProvider('sdk', {
      mode: env.ARCA_MODE,
      credentials: platform.credentials,
      allowProduction: env.ARCA_ALLOW_PRODUCTION === 'true',
      overrides: { representedCuit: org.cuit, wsaaSessionStore: createWsaaSessionStore(env, prisma) },
    })
    setCachedProvider(org.id, key, provider)
  }
  return provider
}

export interface StoredDelegation {
  /** CUIT que tenía la organización cuando se consultó a ARCA: si cambió, la fila no vale. */
  verifiedCuit: string | null
  status: 'VERIFIED' | 'FAILED'
  environment: 'HOMOLOGACION' | 'PRODUCCION'
}

export const environmentOf = (env: Pick<DelegationEnv, 'ARCA_MODE'>): 'HOMOLOGACION' | 'PRODUCCION' => (env.ARCA_MODE === 'produccion' ? 'PRODUCCION' : 'HOMOLOGACION')

export async function loadDelegationForOrganization(org: { id: number }): Promise<StoredDelegation | null> {
  try {
    return await prisma.arcaDelegation.findUnique({ where: { organizationId: org.id }, select: { status: true, environment: true, verifiedCuit: true } })
  } catch (error) {
    console.error(`[arca] no se pudo leer la delegación de la organización ${org.id}: ${error instanceof Error ? error.name : 'Error'}`)
    throw new ProviderUnavailableError('No se pudo leer la delegación de ARCA de la organización.')
  }
}
