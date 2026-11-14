import { afterEach, describe, expect, it, vi } from 'vitest'
import { getFiscalProviderForOrganization, resetOrganizationProviders } from './provider-for-organization.js'
import { resetFiscalProviderCache } from './provider-from-env.js'
import { ArcaSimulatedClient } from './simulated/arca-simulated-client.js'
import { ProviderUnavailableError } from './errors.js'
import { evictOrganizationProviders } from './provider-cache.js'

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

  it('con las variables ARCA_* y sdk en producción sigue bloqueado si no se confirma de forma explícita', async () => {
    const envWithCredentials = { ...sdkEnv, ARCA_MODE: 'produccion' as const, ARCA_CUIT: org.cuit, ARCA_CERT_PEM: CERT, ARCA_KEY_PEM: KEY }

    await expect(getFiscalProviderForOrganization(envWithCredentials, org, { loadCredentials: async () => null })).rejects.toThrow(
      /ARCA_ALLOW_PRODUCTION=true/,
    )
  })

  it('todo lo que no se puede armar sale como ProviderUnavailableError, con un mensaje seguro', async () => {
    const failure = getFiscalProviderForOrganization(sdkEnv, org, { loadCredentials: async () => null })

    await expect(failure).rejects.toBeInstanceOf(ProviderUnavailableError)
  })

  it('un error de la base al leer la credencial no llega al usuario: sale genérico', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const loadCredentials = async () => {
      throw new Error("Can't reach database server at db.interno:5432")
    }

    const failure = getFiscalProviderForOrganization(sdkEnv, org, { loadCredentials })

    await expect(failure).rejects.toThrow('No se pudo leer la credencial de ARCA de la organización.')
    await expect(failure).rejects.not.toThrow(/db\.interno/)
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/db\.interno/)
    log.mockRestore()
  })

  it('un error de descifrado o de clave de cifrado sí se informa, porque lo puede corregir quien administra el servidor', async () => {
    const loadCredentials = async () => {
      throw new Error('No se pudo descifrar el secreto guardado: la clave de cifrado o el registro no corresponden.')
    }

    await expect(getFiscalProviderForOrganization(sdkEnv, org, { loadCredentials })).rejects.toThrow(/No se pudo descifrar/)
  })

  it('una credencial de homologación no se manda a producción', async () => {
    await expect(
      getFiscalProviderForOrganization({ ...sdkEnv, ARCA_MODE: 'produccion', ARCA_ALLOW_PRODUCTION: 'true' }, org, { loadCredentials: async () => stored() }),
    ).rejects.toThrow(/credencial cargada es de homologación/)
  })

  it('al evictar una organización se arma un cliente nuevo', async () => {
    const first = await getFiscalProviderForOrganization(sdkEnv, org, { loadCredentials: async () => stored('huella-1') })
    evictOrganizationProviders(org.id)
    const second = await getFiscalProviderForOrganization(sdkEnv, org, { loadCredentials: async () => stored('huella-1') })

    expect(second).not.toBe(first)
  })
})
