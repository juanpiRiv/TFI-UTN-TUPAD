import { describe, expect, it } from 'vitest'
import type { CaeRequest } from '../fiscal-provider.js'
import { runFiscalProviderContract } from '../contract/fiscal-provider.contract.js'
import { ArcaSimulatedClient, SIMULATED_WATERMARK } from './arca-simulated-client.js'

runFiscalProviderContract('ArcaSimulatedClient', {
  createHarness: () => {
    const provider = new ArcaSimulatedClient()
    return { provider, force: (s) => provider.setScenario(s), expectSimulated: true }
  },
})

function req(over: Partial<CaeRequest> = {}): CaeRequest {
  return {
    cuit: '20000000001',
    pointOfSale: 1,
    voucherType: 11,
    concept: 1,
    docType: 99,
    docNumber: '0',
    receiverIvaConditionId: 5,
    voucherNumber: 1,
    voucherDate: '20261019',
    netAmount: '1000.00',
    ivaAmount: '0.00',
    totalAmount: '1000.00',
    currency: 'PES',
    exchangeRate: '1.000000',
    idempotencyKey: 'k-1',
    ...over,
  }
}

describe('ArcaSimulatedClient', () => {
  it('siempre informa simulated:true y lleva la leyenda de comprobante de prueba', async () => {
    for (const scenario of ['AUTHORIZED', 'WITH_OBSERVATIONS', 'REJECTED', 'TIMEOUT'] as const) {
      const c = new ArcaSimulatedClient({ scenario })
      const r = await c.requestCae(req())
      expect(r.simulated).toBe(true)
      expect((r.raw as { watermark: string }).watermark).toBe(SIMULATED_WATERMARK)
    }
    expect(SIMULATED_WATERMARK).toContain('SIN VALIDEZ FISCAL')
  })

  it('el CAE ficticio es determinista y de 14 digitos', async () => {
    const a = await new ArcaSimulatedClient().requestCae(req())
    const b = await new ArcaSimulatedClient().requestCae(req())
    expect(a.cae).toMatch(/^\d{14}$/)
    expect(a.cae).toBe(b.cae)
    const other = await new ArcaSimulatedClient().requestCae(req({ idempotencyKey: 'k-2' }))
    expect(other.cae).not.toBe(a.cae)
  })

  it('el vencimiento es voucherDate + 10 dias (convencion del simulador)', async () => {
    const r = await new ArcaSimulatedClient().requestCae(req({ voucherDate: '20261225' }))
    expect(r.caeExpiration).toBe('20270104')
  })

  it('numera de forma consecutiva por (cuit, puntoVenta, tipo)', async () => {
    const c = new ArcaSimulatedClient()
    await c.requestCae(req({ idempotencyKey: 'a', voucherNumber: 1 }))
    await c.requestCae(req({ idempotencyKey: 'b', voucherNumber: 2 }))
    await c.requestCae(req({ idempotencyKey: 'c', voucherNumber: 1, pointOfSale: 2 }))
    expect(await c.getLastAuthorized({ cuit: '20000000001', pointOfSale: 1, voucherType: 11 })).toEqual({
      voucherNumber: 2,
    })
    expect(await c.getLastAuthorized({ cuit: '20000000001', pointOfSale: 2, voucherType: 11 })).toEqual({
      voucherNumber: 1,
    })
    expect(await c.getLastAuthorized({ cuit: '20000000001', pointOfSale: 1, voucherType: 12 })).toEqual({
      voucherNumber: 0,
    })
  })

  it('rechaza un numero no consecutivo sin avanzar la numeracion', async () => {
    const c = new ArcaSimulatedClient()
    const r = await c.requestCae(req({ voucherNumber: 5 }))
    expect(r.outcome).toBe('REJECTED')
    expect(r.cae).toBeUndefined()
    expect((await c.getLastAuthorized({ cuit: '20000000001', pointOfSale: 1, voucherType: 11 })).voucherNumber).toBe(0)
  })

  it('rechaza importes que no son strings decimales', async () => {
    const c = new ArcaSimulatedClient()
    const r = await c.requestCae(req({ totalAmount: 1000 as unknown as string }))
    expect(r.outcome).toBe('REJECTED')
  })

  it('timeout: INDETERMINATE; si el comprobante quedo registrado, el reintento con la misma clave lo recupera', async () => {
    const c = new ArcaSimulatedClient({ scenario: 'TIMEOUT', timeoutRegistersVoucher: true })
    const first = await c.requestCae(req())
    expect(first.outcome).toBe('INDETERMINATE')
    expect(first.cae).toBeUndefined()
    expect((await c.getLastAuthorized({ cuit: '20000000001', pointOfSale: 1, voucherType: 11 })).voucherNumber).toBe(1)
    const retry = await c.requestCae(req())
    expect(retry.outcome).toBe('AUTHORIZED')
    expect(retry.cae).toMatch(/^\d{14}$/)
    const again = await c.requestCae(req())
    expect(again.cae).toBe(retry.cae)
  })

  it('timeout sin registro: el reintento puede resolverse distinto', async () => {
    const c = new ArcaSimulatedClient({ scenario: 'TIMEOUT' })
    expect((await c.requestCae(req())).outcome).toBe('INDETERMINATE')
    expect((await c.getLastAuthorized({ cuit: '20000000001', pointOfSale: 1, voucherType: 11 })).voucherNumber).toBe(0)
    c.setScenario('AUTHORIZED')
    expect((await c.requestCae(req())).outcome).toBe('AUTHORIZED')
  })

  it('scenarioFor decide por pedido', async () => {
    const c = new ArcaSimulatedClient({
      scenarioFor: (r) => (r.totalAmount === '999.00' ? 'REJECTED' : 'AUTHORIZED'),
    })
    expect((await c.requestCae(req({ totalAmount: '999.00' }))).outcome).toBe('REJECTED')
    expect((await c.requestCae(req({ idempotencyKey: 'z' }))).outcome).toBe('AUTHORIZED')
  })

  it('healthCheck refleja el estado configurado', async () => {
    const c = new ArcaSimulatedClient({ healthy: false })
    expect((await c.healthCheck()).ok).toBe(false)
    c.setHealthy(true)
    const h = await c.healthCheck()
    expect(h.ok).toBe(true)
    expect(h.detail).toContain('SIMULADO')
  })

  it('el resultado devuelto es una copia: mutarlo no altera la idempotencia', async () => {
    const c = new ArcaSimulatedClient()
    const a = await c.requestCae(req())
    a.observations.push({ code: 1, message: 'x' })
    const b = await c.requestCae(req())
    expect(b.observations).toHaveLength(0)
  })
})
