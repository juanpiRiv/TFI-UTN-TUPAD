import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { getFiscalProviderForOrganization, resetOrganizationProviders } from './provider-for-organization.js'
import { resetFiscalProviderCache } from './provider-from-env.js'
import { evictOrganizationProviders } from './provider-cache.js'
import { ProviderUnavailableError } from './errors.js'
import { generateCsr } from './arca-csr.service.js'
import { loadPlatformCredentials } from './delegation-platform.js'
import type { ArcaSdkClient } from './sdk/arca-sdk-client.js'
import { signCsr } from '../../test-utils/arca-fixtures.js'

const PLATFORM = '20345678906'
const org = { id: 11, cuit: '27000000004' }
const other = { id: 12, cuit: '30711111118' }
const NOT_CONNECTED = /Todavía no conectaste tu cuenta con ARCA/

let platformEnv: Record<string, string>
let rotatedEnv: Record<string, string>

async function platformPem() {
  const { csr, privateKeyPem } = await generateCsr({ legalName: 'Plataforma', cuit: PLATFORM })
  return { ARCA_CERT_PEM: await signCsr(csr, { cuit: PLATFORM }), ARCA_KEY_PEM: privateKeyPem }
}

const baseEnv = () => ({ ARCA_PROVIDER: 'sdk', ARCA_MODE: 'homologacion' as const, ARCA_ENCRYPTION_KEY: 'a'.repeat(64), ARCA_CUIT: PLATFORM })
const delegatedEnv = (over: Record<string, string> = {}) => ({ ...baseEnv(), ARCA_DELEGATION: 'true', ...platformEnv, ...over })
const verified = (environment: 'HOMOLOGACION' | 'PRODUCCION' = 'HOMOLOGACION', verifiedCuit?: string) => async (o: { cuit: string }) => ({ status: 'VERIFIED' as const, environment, verifiedCuit: verifiedCuit ?? o.cuit })
const none = async () => null

beforeAll(async () => {
  platformEnv = await platformPem()
  rotatedEnv = await platformPem()
})

afterEach(() => {
  resetOrganizationProviders()
  resetFiscalProviderCache()
  vi.restoreAllMocks()
})

describe('modo delegado: selección del proveedor', () => {
  it('con delegación verificada firma con el certificado de la plataforma y emite en nombre de la organización', async () => {
    const provider = (await getFiscalProviderForOrganization(delegatedEnv(), org, { loadCredentials: none, loadDelegation: verified() })) as ArcaSdkClient

    expect(provider.issuerCuit).toBe(org.cuit)
    expect(provider.signerCuit).toBe(PLATFORM)
    expect(provider.environment).toBe('homologacion')
  })

  it('la credencial propia de la organización gana sobre la delegación (y ni siquiera consulta la delegación)', async () => {
    const loadDelegation = vi.fn(verified())
    const own = { credentials: { cuit: org.cuit, certificatePem: '-----BEGIN CERTIFICATE-----\nfalso\n-----END CERTIFICATE-----', privateKeyPem: '-----BEGIN PRIVATE KEY-----\nfalso\n-----END PRIVATE KEY-----' }, fingerprint: 'propia' }

    const provider = (await getFiscalProviderForOrganization(delegatedEnv(), org, { loadCredentials: async () => own, loadDelegation })) as ArcaSdkClient

    expect(provider.signerCuit).toBe(org.cuit)
    expect(loadDelegation).not.toHaveBeenCalled()
  })

  it('la delegación gana sobre las variables ARCA_* cuando el CUIT de la organización coincide con el de la plataforma: no hay nada que delegar', async () => {
    const loadDelegation = vi.fn(verified())

    const provider = (await getFiscalProviderForOrganization(delegatedEnv(), { id: 13, cuit: PLATFORM }, { loadCredentials: none, loadDelegation })) as ArcaSdkClient

    expect(provider.issuerCuit).toBe(PLATFORM)
    expect(loadDelegation).not.toHaveBeenCalled()
  })

  it('con el CUIT de las variables y sin delegación sigue sirviendo el camino de desarrollo', async () => {
    const provider = await getFiscalProviderForOrganization(delegatedEnv(), { id: 14, cuit: PLATFORM }, { loadCredentials: none, loadDelegation: none })

    expect(provider.issuerCuit).toBe(PLATFORM)
  })

  it.each([
    ['sin delegación', none, {}],
    ['con delegación fallida', async (o: { cuit: string }) => ({ status: 'FAILED' as const, environment: 'HOMOLOGACION' as const, verifiedCuit: o.cuit }), {}],
    ['con ARCA_DELEGATION apagada', verified(), { ARCA_DELEGATION: 'false' }],
    ['con ARCA_DELEGATION con otro valor', verified(), { ARCA_DELEGATION: 'TRUE' }],
  ])('una organización con otro CUIT %s nunca recibe el certificado de la plataforma', async (_name, loadDelegation, over) => {
    const failure = getFiscalProviderForOrganization(delegatedEnv(over), org, { loadCredentials: none, loadDelegation })

    await expect(failure).rejects.toBeInstanceOf(ProviderUnavailableError)
    await expect(failure).rejects.toMatchObject({ userMessage: expect.stringMatching(NOT_CONNECTED) })
  })

  it('si el CUIT de la organización cambió después de verificar, la delegación no se usa (ni con el CUIT viejo ni con una fila sin CUIT)', async () => {
    for (const verifiedCuit of ['30711111118', null]) {
      const loadDelegation = async () => ({ status: 'VERIFIED' as const, environment: 'HOMOLOGACION' as const, verifiedCuit })
      await expect(getFiscalProviderForOrganization(delegatedEnv(), org, { loadCredentials: none, loadDelegation })).rejects.toMatchObject({
        userMessage: expect.stringMatching(NOT_CONNECTED),
      })
    }
  })

  it('con ARCA_DELEGATION apagada tampoco se consulta la tabla de delegaciones', async () => {
    const loadDelegation = vi.fn(verified())

    await expect(getFiscalProviderForOrganization(delegatedEnv({ ARCA_DELEGATION: '' }), org, { loadCredentials: none, loadDelegation })).rejects.toThrow()
    expect(loadDelegation).not.toHaveBeenCalled()
  })

  it('sin las variables ARCA_* de la plataforma no hay modo delegado aunque la delegación esté verificada', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = { ...baseEnv(), ARCA_DELEGATION: 'true' }

    await expect(getFiscalProviderForOrganization(env, org, { loadCredentials: none, loadDelegation: verified() })).rejects.toMatchObject({
      userMessage: expect.stringMatching(NOT_CONNECTED),
    })
    expect(log).toHaveBeenCalled()
  })

  it('con el proveedor simulated el modo delegado no existe', () => {
    expect(loadPlatformCredentials({ ...delegatedEnv(), ARCA_PROVIDER: 'simulated' })).toBeNull()
  })

  it('un error al leer la delegación sale como error seguro, sin detalles de la base', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {})
    const loadDelegation = async () => {
      throw new Error("Can't reach database server at db.interno:5432")
    }

    const failure = getFiscalProviderForOrganization(delegatedEnv(), org, { loadCredentials: none, loadDelegation })

    await expect(failure).rejects.toBeInstanceOf(ProviderUnavailableError)
    await expect(failure).rejects.not.toThrow(/db\.interno/)
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/db\.interno/)
  })
})

describe('modo delegado: caché', () => {
  it('reutiliza el cliente de una organización y no lo comparte con otra', async () => {
    const deps = { loadCredentials: none, loadDelegation: verified() }
    const first = await getFiscalProviderForOrganization(delegatedEnv(), org, deps)
    const again = await getFiscalProviderForOrganization(delegatedEnv(), org, deps)
    const otherOrg = await getFiscalProviderForOrganization(delegatedEnv(), other, deps)

    expect(again).toBe(first)
    expect(otherOrg).not.toBe(first)
    expect(otherOrg.issuerCuit).toBe(other.cuit)
  })

  it('al evictar la organización se arma un cliente nuevo', async () => {
    const deps = { loadCredentials: none, loadDelegation: verified() }
    const first = await getFiscalProviderForOrganization(delegatedEnv(), org, deps)
    evictOrganizationProviders(org.id)

    expect(await getFiscalProviderForOrganization(delegatedEnv(), org, deps)).not.toBe(first)
  })

  it('al rotar el certificado de la plataforma se arma un cliente nuevo', async () => {
    const deps = { loadCredentials: none, loadDelegation: verified() }
    const first = await getFiscalProviderForOrganization(delegatedEnv(), org, deps)
    const rotated = await getFiscalProviderForOrganization(delegatedEnv(rotatedEnv), org, deps)

    expect(rotated).not.toBe(first)
  })

  it('si la delegación deja de estar verificada, el cliente guardado no se sigue sirviendo', async () => {
    await getFiscalProviderForOrganization(delegatedEnv(), org, { loadCredentials: none, loadDelegation: verified() })

    await expect(getFiscalProviderForOrganization(delegatedEnv(), org, { loadCredentials: none, loadDelegation: none })).rejects.toThrow()
  })
})

describe('modo delegado: producción', () => {
  const production = (over: Record<string, string> = {}) => delegatedEnv({ ARCA_MODE: 'produccion', ARCA_ALLOW_PRODUCTION: 'true', ...over }) as ReturnType<typeof delegatedEnv> & { ARCA_MODE: 'produccion' }

  it('sin ARCA_ALLOW_PRODUCTION el modo delegado no está disponible en producción', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const env = production({ ARCA_ALLOW_PRODUCTION: '' })

    expect(loadPlatformCredentials(env)).toBeNull()
    await expect(getFiscalProviderForOrganization(env, org, { loadCredentials: none, loadDelegation: verified('PRODUCCION') })).rejects.toMatchObject({
      userMessage: expect.stringMatching(NOT_CONNECTED),
    })
  })

  it('una delegación verificada en homologación no se reutiliza en producción', async () => {
    await expect(getFiscalProviderForOrganization(production(), org, { loadCredentials: none, loadDelegation: verified('HOMOLOGACION') })).rejects.toMatchObject({
      userMessage: expect.stringMatching(NOT_CONNECTED),
    })
  })

  it('tampoco una delegación de producción sirve en homologación', async () => {
    await expect(getFiscalProviderForOrganization(delegatedEnv(), org, { loadCredentials: none, loadDelegation: verified('PRODUCCION') })).rejects.toThrow()
  })

  it('en producción confirmada y con delegación verificada en producción emite en nombre de la organización', async () => {
    const provider = await getFiscalProviderForOrganization(production(), org, { loadCredentials: none, loadDelegation: verified('PRODUCCION') })

    expect(provider.environment).toBe('produccion')
    expect(provider.issuerCuit).toBe(org.cuit)
  })
})

describe('camino de variables con el mismo CUIT (la plataforma)', () => {
  const platformOrg = { id: 21, cuit: PLATFORM }

  it('fuera de producción sigue sirviendo como hasta ahora, sin consultar la lista', async () => {
    const isPlatformOwner = vi.fn(async () => false)

    const provider = await getFiscalProviderForOrganization(delegatedEnv(), platformOrg, { loadCredentials: none, loadDelegation: none, isPlatformOwner })

    expect(provider.issuerCuit).toBe(PLATFORM)
    expect(isPlatformOwner).not.toHaveBeenCalled()
  })

  it('en producción exige que el usuario esté en la lista de dueños de la plataforma', async () => {
    const env = delegatedEnv({ NODE_ENV: 'production' })

    await expect(getFiscalProviderForOrganization(env, platformOrg, { loadCredentials: none, loadDelegation: none, isPlatformOwner: async () => false })).rejects.toMatchObject({
      userMessage: expect.stringMatching(NOT_CONNECTED),
    })
    const provider = await getFiscalProviderForOrganization(env, platformOrg, { loadCredentials: none, loadDelegation: none, isPlatformOwner: async () => true })
    expect(provider.issuerCuit).toBe(PLATFORM)
  })
})
