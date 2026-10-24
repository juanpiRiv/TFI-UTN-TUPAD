import { describe, expect, it, vi } from 'vitest'
import type { ArcaClient } from 'facturas'
import { createFiscalProvider, parseArcaProviderKind } from './provider-factory.js'
import { ArcaSimulatedClient } from './simulated/arca-simulated-client.js'
import { ArcaSdkClient } from './sdk/arca-sdk-client.js'

const credentials = {
  cuit: '20000000001',
  certificatePem: '-----BEGIN CERTIFICATE-----\nfalso\n-----END CERTIFICATE-----',
  privateKeyPem: '-----BEGIN PRIVATE KEY-----\nfalso\n-----END PRIVATE KEY-----',
}

describe('parseArcaProviderKind (ARCA_PROVIDER)', () => {
  it.each(['simulated', 'sdk', 'direct'] as const)('acepta %s', (value) => {
    expect(parseArcaProviderKind(value)).toBe(value)
  })

  it('ignora espacios alrededor del valor', () => {
    expect(parseArcaProviderKind('  sdk ')).toBe('sdk')
  })

  it('falla con un mensaje claro si falta', () => {
    expect(() => parseArcaProviderKind(undefined)).toThrow(/ARCA_PROVIDER es obligatoria.*simulated, sdk, direct/)
    expect(() => parseArcaProviderKind('')).toThrow(/ARCA_PROVIDER es obligatoria/)
  })

  it('falla con un mensaje claro si el valor no existe', () => {
    expect(() => parseArcaProviderKind('afip')).toThrow(/ARCA_PROVIDER="afip" no es válida.*simulated, sdk, direct/)
  })
})

describe('createFiscalProvider', () => {
  it('simulated devuelve el cliente simulado, que informa simulated:true', async () => {
    const provider = createFiscalProvider('simulated')

    expect(provider).toBeInstanceOf(ArcaSimulatedClient)
    const result = await provider.requestCae({
      cuit: credentials.cuit,
      pointOfSale: 1,
      voucherType: 11,
      concept: 1,
      docType: 99,
      docNumber: '0',
      receiverIvaConditionId: 5,
      voucherNumber: 1,
      voucherDate: '20261024',
      netAmount: '1000.00',
      ivaAmount: '0.00',
      totalAmount: '1000.00',
      currency: 'PES',
      exchangeRate: '1.000000',
      idempotencyKey: 'factory-test',
    })
    expect(result.simulated).toBe(true)
  })

  it('sdk devuelve el cliente sobre la librería facturas', () => {
    const clientFactory = vi.fn((_config: unknown) => ({}) as ArcaClient)
    const provider = createFiscalProvider('sdk', { credentials, overrides: { clientFactory } })

    expect(provider).toBeInstanceOf(ArcaSdkClient)
    expect(clientFactory).toHaveBeenCalledTimes(1)
  })

  it('sdk usa homologación por defecto y producción solo si se pide', () => {
    const clientFactory = vi.fn((_config: unknown) => ({}) as ArcaClient)

    createFiscalProvider('sdk', { credentials, overrides: { clientFactory } })
    createFiscalProvider('sdk', { credentials, mode: 'produccion', overrides: { clientFactory } })

    expect(clientFactory.mock.calls[0]![0]).toMatchObject({ environment: 'test' })
    expect(clientFactory.mock.calls[1]![0]).toMatchObject({ environment: 'production' })
  })

  it('sdk sin credenciales falla con un mensaje claro', () => {
    expect(() => createFiscalProvider('sdk')).toThrow(/ARCA_PROVIDER=sdk necesita las credenciales/)
  })

  it('direct todavía no está disponible y lo dice', () => {
    expect(() => createFiscalProvider('direct')).toThrow(/ARCA_PROVIDER=direct todavía no está disponible/)
  })
})
