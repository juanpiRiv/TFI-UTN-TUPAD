import { describe, expect, it } from 'vitest'
import { buildCaeRequest } from './cae-request.js'

const base = {
  cuit: '20000000001',
  pointOfSaleNumber: 3,
  voucherNumber: 12,
  invoice: {
    id: 99,
    voucherType: 'FACTURA_C' as const,
    concept: 'PRODUCTOS' as const,
    issueDate: new Date('2026-10-24T00:00:00.000Z'),
    serviceFrom: null,
    serviceTo: null,
    paymentDueDate: null,
    recipientDocType: 'CUIT' as const,
    recipientDocNumber: '30712345678',
    recipientTaxCondition: 'RESPONSABLE_INSCRIPTO' as const,
    currency: 'ARS' as const,
    fiscalExchangeRate: '1',
    totalAmount: '215.02',
  },
}

describe('buildCaeRequest (Factura C para FiscalProvider)', () => {
  it('arma el pedido con los códigos de ARCA y los importes de una Factura C', () => {
    expect(buildCaeRequest(base)).toEqual({
      cuit: '20000000001',
      pointOfSale: 3,
      voucherType: 11,
      concept: 1,
      docType: 80,
      docNumber: '30712345678',
      receiverIvaConditionId: 1,
      voucherNumber: 12,
      voucherDate: '20261024',
      netAmount: '215.02',
      ivaAmount: '0.00',
      totalAmount: '215.02',
      currency: 'PES',
      exchangeRate: '1.000000',
      idempotencyKey: 'invoice-99',
    })
  })

  it('para servicios incluye el período y el vencimiento en YYYYMMDD', () => {
    const request = buildCaeRequest({
      ...base,
      invoice: {
        ...base.invoice,
        concept: 'SERVICIOS',
        serviceFrom: new Date('2026-10-01T00:00:00.000Z'),
        serviceTo: new Date('2026-10-31T00:00:00.000Z'),
        paymentDueDate: new Date('2026-11-23T00:00:00.000Z'),
      },
    })

    expect(request).toMatchObject({
      concept: 2,
      serviceStartDate: '20261001',
      serviceEndDate: '20261031',
      paymentDueDate: '20261123',
    })
  })

  it('consumidor final sin identificar usa documento 99 y condición 5', () => {
    const request = buildCaeRequest({
      ...base,
      invoice: {
        ...base.invoice,
        recipientDocType: 'SIN_IDENTIFICAR',
        recipientDocNumber: '0',
        recipientTaxCondition: 'CONSUMIDOR_FINAL',
      },
    })

    expect(request).toMatchObject({ docType: 99, docNumber: '0', receiverIvaConditionId: 5 })
  })

  it('sin datos del receptor cae en consumidor final', () => {
    const request = buildCaeRequest({
      ...base,
      invoice: { ...base.invoice, recipientDocType: null, recipientDocNumber: null, recipientTaxCondition: null },
    })

    expect(request).toMatchObject({ docType: 99, docNumber: '0', receiverIvaConditionId: 5 })
  })

  it('rechaza un tipo de comprobante que todavía no se emite', () => {
    expect(() =>
      buildCaeRequest({ ...base, invoice: { ...base.invoice, voucherType: 'NOTA_CREDITO_C' } }),
    ).toThrow(/solo se emite Factura C/)
  })

  it('rechaza una moneda distinta de pesos en el P0', () => {
    expect(() => buildCaeRequest({ ...base, invoice: { ...base.invoice, currency: 'USD' } })).toThrow(/solo pesos/)
  })
})
