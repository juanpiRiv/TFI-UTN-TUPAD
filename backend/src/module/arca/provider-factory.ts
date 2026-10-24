import type { FiscalProvider } from './fiscal-provider.js'
import { ArcaSdkClient, type ArcaSdkClientOptions } from './sdk/arca-sdk-client.js'
import { ArcaSimulatedClient } from './simulated/arca-simulated-client.js'

/** Valores válidos de ARCA_PROVIDER. */
export const ARCA_PROVIDER_KINDS = ['simulated', 'sdk', 'direct'] as const
export type ArcaProviderKind = (typeof ARCA_PROVIDER_KINDS)[number]

/** Valores válidos de ARCA_MODE. */
export type ArcaMode = 'homologacion' | 'produccion'

/** Credenciales de una organización. Viven en la tabla ArcaCredential, no en variables de entorno. */
export interface ArcaCredentials {
  cuit: string
  certificatePem: string
  privateKeyPem: string
}

export interface CreateFiscalProviderOptions {
  /** Obligatorias para `sdk`. El simulado no las usa. */
  credentials?: ArcaCredentials
  /** Por defecto homologación: producción hay que pedirla de forma explícita. */
  mode?: ArcaMode
  /** Solo para tests: pisa opciones del cliente sobre la librería. */
  overrides?: Partial<ArcaSdkClientOptions>
}

const VALID = ARCA_PROVIDER_KINDS.join(', ')

/** Valida el valor de ARCA_PROVIDER. Lanza un error con el valor recibido y los válidos. */
export function parseArcaProviderKind(value: string | undefined): ArcaProviderKind {
  const kind = value?.trim()
  if (!kind) {
    throw new Error(`ARCA_PROVIDER es obligatoria. Valores válidos: ${VALID}.`)
  }
  if (!(ARCA_PROVIDER_KINDS as readonly string[]).includes(kind)) {
    throw new Error(`ARCA_PROVIDER="${kind}" no es válida. Valores válidos: ${VALID}.`)
  }
  return kind as ArcaProviderKind
}

/** Devuelve el proveedor fiscal según ARCA_PROVIDER, para cambiar de uno a otro sin tocar código. */
export function createFiscalProvider(
  kind: ArcaProviderKind,
  options: CreateFiscalProviderOptions = {},
): FiscalProvider {
  switch (kind) {
    case 'simulated':
      return new ArcaSimulatedClient()
    case 'sdk': {
      if (!options.credentials) {
        throw new Error('ARCA_PROVIDER=sdk necesita las credenciales (CUIT, certificado y clave) de la organización.')
      }
      return new ArcaSdkClient({
        ...options.credentials,
        environment: options.mode === 'produccion' ? 'production' : 'test',
        ...options.overrides,
      })
    }
    case 'direct':
      throw new Error('ARCA_PROVIDER=direct todavía no está disponible: el cliente propio está en el PR #141.')
  }
}
