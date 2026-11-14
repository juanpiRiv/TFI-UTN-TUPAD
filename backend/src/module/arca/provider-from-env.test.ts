import { afterEach, describe, expect, it } from 'vitest'
import { ArcaSimulatedClient } from './simulated/arca-simulated-client.js'
import { getFiscalProviderFromEnv, resetFiscalProviderCache } from './provider-from-env.js'

const CERT = '-----BEGIN CERTIFICATE-----\nfalso\n-----END CERTIFICATE-----'
const KEY = '-----BEGIN PRIVATE KEY-----\nfalso\n-----END PRIVATE KEY-----'
const sdkEnv = { ARCA_PROVIDER: 'sdk', ARCA_MODE: 'homologacion' as const, ARCA_CUIT: '20000000001', ARCA_CERT_PEM: CERT, ARCA_KEY_PEM: KEY }

afterEach(() => resetFiscalProviderCache())

describe('getFiscalProviderFromEnv', () => {
  it('con simulated no necesita credenciales', () => {
    expect(getFiscalProviderFromEnv({ ARCA_PROVIDER: 'simulated', ARCA_MODE: 'homologacion' })).toBeInstanceOf(ArcaSimulatedClient)
  })

  it('con sdk arma el cliente con las credenciales del entorno y lo reutiliza', () => {
    const first = getFiscalProviderFromEnv(sdkEnv)
    const second = getFiscalProviderFromEnv(sdkEnv)

    expect(first.name).toBe('arca-sdk(facturas)')
    expect(second).toBe(first)
  })

  it('con sdk y sin credenciales falla antes de llamar a ARCA', () => {
    expect(() => getFiscalProviderFromEnv({ ARCA_PROVIDER: 'sdk', ARCA_MODE: 'homologacion' })).toThrow(/ARCA_CUIT es obligatoria/)
  })

  it('con sdk en producción falla si no se confirma de forma explícita', () => {
    expect(() => getFiscalProviderFromEnv({ ...sdkEnv, ARCA_MODE: 'produccion' })).toThrow(/ARCA_ALLOW_PRODUCTION=true/)
    expect(() => getFiscalProviderFromEnv({ ...sdkEnv, ARCA_MODE: 'produccion', ARCA_ALLOW_PRODUCTION: 'yes' })).toThrow(
      /ARCA_ALLOW_PRODUCTION=true/,
    )
  })

  it('con un ARCA_PROVIDER inválido falla con el mensaje de siempre', () => {
    expect(() => getFiscalProviderFromEnv({ ARCA_PROVIDER: 'afip', ARCA_MODE: 'homologacion' })).toThrow(/no es válida/)
  })
})
