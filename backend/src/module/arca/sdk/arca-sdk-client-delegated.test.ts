import { describe, expect, it, vi } from 'vitest'
import type { ArcaClient } from 'facturas'
import { ArcaSdkClient } from './arca-sdk-client.js'
import { ArcaSdkInputError } from './errors.js'
import type { CaeRequest } from '../fiscal-provider.js'

const PLATFORM = '20345678906'
const CLIENT = '27000000004'

function build(representedCuit?: string) {
  const getNextVoucherNumber = vi.fn(async (_input: unknown) => 8)
  const issue = vi.fn(async (_input: unknown) => ({ kind: 'authorized', cae: '75000000000001', caeExpiry: '20261201', observations: [], errors: [] }))
  const clientFactory = vi.fn((_config: unknown) => ({ wsfe: { getNextVoucherNumber, issue, getServerStatus: vi.fn() } }) as unknown as ArcaClient)
  const client = new ArcaSdkClient({ cuit: PLATFORM, certificatePem: 'c', privateKeyPem: 'k', ...(representedCuit ? { representedCuit } : {}), clientFactory })
  return { client, clientFactory, getNextVoucherNumber, issue }
}

const request = (cuit: string): CaeRequest => ({
  cuit, pointOfSale: 1, voucherType: 11, concept: 1, docType: 99, docNumber: '0', receiverIvaConditionId: 5, voucherNumber: 9,
  voucherDate: '20261116', netAmount: '1000.00', ivaAmount: '0.00', totalAmount: '1000.00', currency: 'PES', exchangeRate: '1', idempotencyKey: 'k',
})

describe('ArcaSdkClient en modo delegado', () => {
  it('firma con el CUIT de la plataforma pero emite en nombre del representado', () => {
    const { client, clientFactory } = build(CLIENT)

    expect(client.issuerCuit).toBe(CLIENT)
    expect(client.signerCuit).toBe(PLATFORM)
    expect((clientFactory.mock.calls[0]![0] as { taxId: string }).taxId).toBe(PLATFORM)
  })

  it('sin representedCuit el emisor es el del certificado (modo propio, sin cambios)', () => {
    const { client } = build()

    expect(client.issuerCuit).toBe(PLATFORM)
    expect(client.signerCuit).toBe(PLATFORM)
  })

  it('el último autorizado se consulta con el CUIT representado', async () => {
    const { client, getNextVoucherNumber } = build(CLIENT)

    const last = await client.getLastAuthorized({ cuit: CLIENT, pointOfSale: 3, voucherType: 11 })

    expect(last).toEqual({ voucherNumber: 7 })
    expect(getNextVoucherNumber).toHaveBeenCalledWith({ representedTaxId: CLIENT, salesPoint: 3, voucherType: 11 })
  })

  it('el pedido de CAE lleva el CUIT representado', async () => {
    const { client, issue } = build(CLIENT)

    const result = await client.requestCae(request(CLIENT))

    expect(result.outcome).toBe('AUTHORIZED')
    expect(issue).toHaveBeenCalledTimes(1)
    expect((issue.mock.calls[0]![0] as { representedTaxId: string }).representedTaxId).toBe(CLIENT)
  })

  it('rechaza pedir en nombre de otro CUIT, incluido el de la plataforma, sin llamar a ARCA', async () => {
    const { client, issue, getNextVoucherNumber } = build(CLIENT)

    await expect(client.requestCae(request(PLATFORM))).rejects.toBeInstanceOf(ArcaSdkInputError)
    await expect(client.getLastAuthorized({ cuit: '30711111118', pointOfSale: 1, voucherType: 11 })).rejects.toBeInstanceOf(ArcaSdkInputError)
    expect(issue).not.toHaveBeenCalled()
    expect(getNextVoucherNumber).not.toHaveBeenCalled()
  })

  it('un representedCuit mal formado falla al armar el cliente', () => {
    expect(() => build('123')).toThrow(ArcaSdkInputError)
  })
})
