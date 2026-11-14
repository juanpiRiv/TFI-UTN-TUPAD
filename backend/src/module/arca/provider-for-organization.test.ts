import { afterEach, describe, expect, it, vi } from 'vitest'
import { getFiscalProviderForOrganization, resetOrganizationProviders } from './provider-for-organization.js'
import { resetFiscalProviderCache } from './provider-from-env.js'
import { ArcaSimulatedClient } from './simulated/arca-simulated-client.js'

const CERT = '-----BEGIN CERTIFICATE-----\nfalso\n-----END CERTIFICATE-----'
const KEY = '-----BEGIN PRIVATE KEY-----\nfalso\n-----END PRIVATE KEY-----'
const org = { id: 5, cuit: '20000000001' }
const stored = (fingerprint = 'huella-1') => ({ credentials: { cuit: org.cuit, certificatePem: CERT, privateKeyPem: KEY }, fingerprint })
const sdkEnv = { ARCA_PROVIDER: 'sdk', ARCA_MODE: 'homologacion' as const, ARCA_ENCRYPTION_KEY: 'a'.repeat(64) }

afterEach(() => {
  resetOrganizationProviders()
  resetFiscalProviderCache()
})

describe('getFiscalProviderForOrganization', () => {
  it('con simulated no consulta credenciales', async () => {
    const loadCredentials = vi.fn()

    const provider = await getFiscalProviderForOrganization({ ARCA_PROVIDER: 'simulated', ARCA_MODE: 'homologacion' }, org, { loadCredentials })

    expect(provider).toBeInstanceOf(ArcaSimulatedClient)
    expect(loadCredentials).not.toHaveBeenCalled()
  })

  it('con sdk usa la credencial que la organización cargó, con el CUIT de la organización', async () => {
    const loadCredentials = vi.fn(async () => stored())

    const provider = await getFiscalProviderForOrganization(sdkEnv, org, { loadCredentials })

    expect(provider.name).toBe('arca-sdk(facturas)')
    expect(provider.issuerCuit).toBe(org.cuit)
    expect(provider.environment).toBe('homologacion')
    expect(loadCredentials).toHaveBeenCalledWith(org, sdkEnv.ARCA_ENCRYPTION_KEY)
  })

  it('reutiliza el cliente de una organización mientras no cambie el certificado y arma otro si lo cambia', async () => {
    const first = await getFiscalProviderForOrganization(sdkEnv, org, { loadCredentials: async () => stored('huella-1') })
    const again = await getFiscalProviderForOrganization(sdkEnv, org, { loadCredentials: async () => stored('huella-1') })
    const replaced = await getFiscalProviderForOrganization(sdkEnv, org, { loadCredentials: async () => stored('huella-2') })

    expect(again).toBe(first)
    expect(replaced).not.toBe(first)
  })

  it('no mezcla los clientes de dos organizaciones', async () => {
    const one = await getFiscalProviderForOrganization(sdkEnv, org, { loadCredentials: async () => stored('misma') })
    const other = { id: 6, cuit: '20000000001' }
    const two = await getFiscalProviderForOrganization(sdkEnv, other, { loadCredentials: async () => stored('misma') })

    expect(two).not.toBe(one)
  })

  it('sin credencial cargada ni variables falla con un mensaje claro en vez de usar el simulador', async () => {
    await expect(getFiscalProviderForOrganization(sdkEnv, org, { loadCredentials: async () => null })).rejects.toThrow(
      /todavía no cargó su credencial de ARCA/,
    )
  })

  it('sin credencial cargada pero con variables ARCA_* usa las del entorno (camino de desarrollo)', async () => {
    const provider = await getFiscalProviderForOrganization(
      { ...sdkEnv, ARCA_CUIT: org.cuit, ARCA_CERT_PEM: CERT, ARCA_KEY_PEM: KEY },
      org,
      { loadCredentials: async () => null },
    )

    expect(provider.issuerCuit).toBe(org.cuit)
  })

  it('con sdk en producción sigue bloqueado si no se confirma de forma explícita', async () => {
    await expect(
      getFiscalProviderForOrganization({ ...sdkEnv, ARCA_MODE: 'produccion' }, org, { loadCredentials: async () => stored() }),
    ).rejects.toThrow(/ARCA_ALLOW_PRODUCTION=true/)
  })
})
