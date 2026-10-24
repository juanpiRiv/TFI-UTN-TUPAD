import { describe, expect, it } from 'vitest'
import type { CaeRequest } from './fiscal-provider.js'
import { serviceDatesError } from './service-dates.js'

function req(over: Partial<CaeRequest> = {}): CaeRequest {
  return {
    cuit: '20000000001',
    pointOfSale: 1,
    voucherType: 11,
    concept: 2,
    docType: 99,
    docNumber: '0',
    receiverIvaConditionId: 5,
    voucherNumber: 1,
    voucherDate: '20261019',
    netAmount: '1000.00',
    ivaAmount: '0.00',
    totalAmount: '1000.00',
    currency: 'PES',
    exchangeRate: '1',
    idempotencyKey: 'k-1',
    serviceStartDate: '20261001',
    serviceEndDate: '20261031',
    paymentDueDate: '20261110',
    ...over,
  }
}

describe('serviceDatesError', () => {
  it('no exige fechas para productos (concepto 1)', () => {
    const { serviceStartDate: _a, serviceEndDate: _b, paymentDueDate: _c, ...sinFechas } = req()
    expect(serviceDatesError({ ...sinFechas, concept: 1 })).toBeUndefined()
  })

  it.each([2, 3])('acepta el concepto %i con las tres fechas', (concept) => {
    expect(serviceDatesError(req({ concept }))).toBeUndefined()
  })

  it.each(['serviceStartDate', 'serviceEndDate', 'paymentDueDate'] as const)('exige %s si hay servicios', (field) => {
    const r = req()
    delete r[field]
    expect(serviceDatesError(r)).toContain(field)
  })

  it('rechaza una fecha que no existe', () => {
    expect(serviceDatesError(req({ serviceEndDate: '20261331' }))).toContain('serviceEndDate')
    expect(serviceDatesError(req({ paymentDueDate: '2026-11-10' }))).toContain('paymentDueDate')
  })

  it('rechaza un periodo invertido', () => {
    expect(serviceDatesError(req({ serviceStartDate: '20261101', serviceEndDate: '20261001' }))).toContain('posterior')
  })
})
