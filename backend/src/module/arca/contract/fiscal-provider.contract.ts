import { describe, expect, it } from 'vitest'
import type { CaeRequest, CaeResult, FiscalOutcome, FiscalProvider } from '../fiscal-provider.js'

/**
 * Escenarios que un arnes puede forzar. Un proveedor real contra homologacion
 * normalmente no puede forzarlos: en ese caso se omite `force` y solo corren
 * las verificaciones de forma.
 */
export type ForcedScenario = 'AUTHORIZED' | 'WITH_OBSERVATIONS' | 'REJECTED' | 'TIMEOUT'

export interface ContractHarness {
  provider: FiscalProvider
  force?: (scenario: ForcedScenario) => void
  /**
   * false si el proveedor no deduplica por idempotencyKey y esa responsabilidad queda en el dominio
   * (el adaptador de la libreria usa la API de bajo nivel, que no tiene idempotencia). Default: true.
   */
  dedupesByKey?: boolean
  /** true si el proveedor debe informar simulated:true. */
  expectSimulated?: boolean
  /** CUIT a usar en los pedidos. Default: CUIT inventado. */
  cuit?: string
  /** Punto de venta a usar. Default: 1. */
  pointOfSale?: number
}

export interface ContractOptions {
  /** Devuelve un arnes NUEVO (estado limpio) por cada test. */
  createHarness: () => ContractHarness | Promise<ContractHarness>
}

// Los codigos numericos de baseRequest son datos de prueba para armar un pedido
// con la forma correcta. NO estan verificados contra la documentacion oficial de ARCA.
const OUTCOMES: FiscalOutcome[] = ['AUTHORIZED', 'AUTHORIZED_WITH_OBSERVATIONS', 'REJECTED', 'INDETERMINATE']
const DECIMAL = /^\d+\.\d{2}$/
const YYYYMMDD = /^\d{8}$/

let keyCounter = 0
function newKey(): string {
  keyCounter += 1
  return `contract-${Date.now()}-${keyCounter}`
}

function baseRequest(h: ContractHarness, voucherNumber: number, over: Partial<CaeRequest> = {}): CaeRequest {
  return {
    cuit: h.cuit ?? '20000000001',
    pointOfSale: h.pointOfSale ?? 1,
    voucherType: 11,
    concept: 1,
    docType: 99,
    docNumber: '0',
    receiverIvaConditionId: 5,
    voucherNumber,
    voucherDate: '20261019',
    netAmount: '1000.00',
    ivaAmount: '0.00',
    totalAmount: '1000.00',
    currency: 'PES',
    exchangeRate: '1.000000',
    idempotencyKey: newKey(),
    ...over,
  }
}

function seqParams(h: ContractHarness) {
  return { cuit: h.cuit ?? '20000000001', pointOfSale: h.pointOfSale ?? 1, voucherType: 11 }
}

async function nextRequest(h: ContractHarness, over: Partial<CaeRequest> = {}): Promise<CaeRequest> {
  const last = await h.provider.getLastAuthorized(seqParams(h))
  return baseRequest(h, last.voucherNumber + 1, over)
}

export function expectValidShape(result: CaeResult): void {
  expect(OUTCOMES).toContain(result.outcome)
  expect(typeof result.simulated).toBe('boolean')
  expect(Array.isArray(result.observations)).toBe(true)
  expect(Array.isArray(result.errors)).toBe(true)
  for (const m of [...result.observations, ...result.errors]) {
    expect(typeof m.code).toBe('number')
    expect(typeof m.message).toBe('string')
    expect(m.message.length).toBeGreaterThan(0)
  }

  const authorized = result.outcome === 'AUTHORIZED' || result.outcome === 'AUTHORIZED_WITH_OBSERVATIONS'
  if (authorized) {
    // Largo maximo 14: restriccion de la columna del repo (VarChar(14)), no una regla de ARCA.
    expect(result.cae).toMatch(/^\d{1,14}$/)
    expect(result.caeExpiration).toMatch(YYYYMMDD)
  } else {
    expect(result.cae).toBeUndefined()
    expect(result.caeExpiration).toBeUndefined()
  }
  if (result.outcome === 'AUTHORIZED') expect(result.errors).toHaveLength(0)
  if (result.outcome === 'AUTHORIZED_WITH_OBSERVATIONS') expect(result.observations.length).toBeGreaterThan(0)
  if (result.outcome === 'REJECTED') expect(result.errors.length).toBeGreaterThan(0)
}

/**
 * Suite de contrato reutilizable. Se llama dentro de un archivo .test.ts:
 *   runFiscalProviderContract('MiProveedor', { createHarness: () => ({ provider }) })
 */
export function runFiscalProviderContract(label: string, options: ContractOptions): void {
  describe(`contrato FiscalProvider: ${label}`, () => {
    it('expone un name no vacio', async () => {
      const h = await options.createHarness()
      expect(typeof h.provider.name).toBe('string')
      expect(h.provider.name.length).toBeGreaterThan(0)
    })

    it('healthCheck devuelve { ok: boolean, detail: string }', async () => {
      const h = await options.createHarness()
      const res = await h.provider.healthCheck()
      expect(typeof res.ok).toBe('boolean')
      expect(typeof res.detail).toBe('string')
    })

    it('getLastAuthorized devuelve un entero >= 0', async () => {
      const h = await options.createHarness()
      const res = await h.provider.getLastAuthorized(seqParams(h))
      expect(Number.isInteger(res.voucherNumber)).toBe(true)
      expect(res.voucherNumber).toBeGreaterThanOrEqual(0)
    })

    it('requestCae devuelve un CaeResult con la forma correcta', async () => {
      const h = await options.createHarness()
      const result = await h.provider.requestCae(await nextRequest(h))
      expectValidShape(result)
      if (h.expectSimulated) expect(result.simulated).toBe(true)
    })

    it('los importes del pedido son strings decimales', async () => {
      const h = await options.createHarness()
      const req = await nextRequest(h)
      for (const v of [req.netAmount, req.ivaAmount, req.totalAmount]) {
        expect(typeof v).toBe('string')
        expect(v).toMatch(DECIMAL)
      }
    })

    it('la misma idempotencyKey no duplica: mismo resultado y la numeracion no avanza de nuevo', async () => {
      const h = await options.createHarness()
      if (h.dedupesByKey === false) return
      const req = await nextRequest(h)
      const first = await h.provider.requestCae(req)
      const afterFirst = await h.provider.getLastAuthorized(seqParams(h))
      const second = await h.provider.requestCae(req)
      const afterSecond = await h.provider.getLastAuthorized(seqParams(h))
      expectValidShape(second)
      if (first.outcome !== 'INDETERMINATE') {
        expect(second.outcome).toBe(first.outcome)
        expect(second.cae).toBe(first.cae)
      }
      expect(afterSecond.voucherNumber).toBe(afterFirst.voucherNumber)
    })

    describe('escenarios forzados (solo si el arnes los soporta)', () => {
      it('autorizado: avanza la numeracion hasta el comprobante emitido', async () => {
        const h = await options.createHarness()
        if (!h.force) return
        h.force('AUTHORIZED')
        const req = await nextRequest(h)
        const result = await h.provider.requestCae(req)
        expect(result.outcome).toBe('AUTHORIZED')
        expectValidShape(result)
        const last = await h.provider.getLastAuthorized(seqParams(h))
        expect(last.voucherNumber).toBe(req.voucherNumber)
      })

      it('con observaciones: trae CAE y al menos una observacion', async () => {
        const h = await options.createHarness()
        if (!h.force) return
        h.force('WITH_OBSERVATIONS')
        const result = await h.provider.requestCae(await nextRequest(h))
        expect(result.outcome).toBe('AUTHORIZED_WITH_OBSERVATIONS')
        expectValidShape(result)
      })

      it('rechazado: sin CAE, con errores, y la numeracion no avanza', async () => {
        const h = await options.createHarness()
        if (!h.force) return
        h.force('REJECTED')
        const before = await h.provider.getLastAuthorized(seqParams(h))
        const result = await h.provider.requestCae(await nextRequest(h))
        expect(result.outcome).toBe('REJECTED')
        expectValidShape(result)
        const after = await h.provider.getLastAuthorized(seqParams(h))
        expect(after.voucherNumber).toBe(before.voucherNumber)
      })

      it('timeout: INDETERMINATE sin CAE ni vencimiento', async () => {
        const h = await options.createHarness()
        if (!h.force) return
        h.force('TIMEOUT')
        const result = await h.provider.requestCae(await nextRequest(h))
        expect(result.outcome).toBe('INDETERMINATE')
        expect(result.cae).toBeUndefined()
        expect(result.caeExpiration).toBeUndefined()
        expectValidShape(result)
      })
    })
  })
}
