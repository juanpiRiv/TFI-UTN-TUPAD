import { describe, expect, it } from 'vitest'
import { AFIP_QR_BASE_URL, buildAfipQrPayload, buildAfipQrUrl, type AfipQrInput } from './afip-qr.js'

const base: AfipQrInput = {
  issueDate: '2026-11-14',
  issuerCuit: '20000000001',
  pointOfSale: 1,
  voucherTypeCode: 11,
  voucherNumber: 3,
  total: '1500.00',
  currency: 'ARS',
  exchangeRate: '1',
  recipientDocType: null,
  recipientDocNumber: null,
  cae: '86461069190744',
}

const decode = (url: string) => {
  const parameter = new URL(url).searchParams.get('p')!
  return JSON.parse(Buffer.from(parameter, 'base64').toString('utf8'))
}

describe('QR de ARCA (RG 4892)', () => {
  it('usa la dirección de verificación de ARCA con el parámetro p', () => {
    const url = buildAfipQrUrl(base)

    expect(url.startsWith(`${AFIP_QR_BASE_URL}?p=`)).toBe(true)
  })

  it('el JSON lleva los campos de la especificación, con números y la moneda de ARCA', () => {
    expect(decode(buildAfipQrUrl(base))).toEqual({
      ver: 1,
      fecha: '2026-11-14',
      cuit: 20000000001,
      ptoVta: 1,
      tipoCmp: 11,
      nroCmp: 3,
      importe: 1500,
      moneda: 'PES',
      ctz: 1,
      tipoDocRec: 99,
      nroDocRec: 0,
      tipoCodAut: 'E',
      codAut: 86461069190744,
    })
  })

  it('un receptor con CUIT o DNI informa su tipo y su número', () => {
    const cuit = buildAfipQrPayload({ ...base, recipientDocType: 'CUIT', recipientDocNumber: '30712345678' })
    const dni = buildAfipQrPayload({ ...base, recipientDocType: 'DNI', recipientDocNumber: '30123456' })

    expect(cuit).toMatchObject({ tipoDocRec: 80, nroDocRec: 30712345678 })
    expect(dni).toMatchObject({ tipoDocRec: 96, nroDocRec: 30123456 })
  })

  it('un receptor sin identificar informa tipo 99 y número 0 aunque traiga un número', () => {
    expect(buildAfipQrPayload({ ...base, recipientDocType: 'SIN_IDENTIFICAR', recipientDocNumber: '123' })).toMatchObject({
      tipoDocRec: 99,
      nroDocRec: 0,
    })
  })

  it('mantiene los decimales del importe', () => {
    expect(buildAfipQrPayload({ ...base, total: '12100.50' }).importe).toBe(12100.5)
  })

  it('rechaza datos que el comprobante autorizado siempre tiene', () => {
    expect(() => buildAfipQrPayload({ ...base, cae: '123' })).toThrow(/CAE/)
    expect(() => buildAfipQrPayload({ ...base, issuerCuit: '2000' })).toThrow(/CUIT/)
    expect(() => buildAfipQrPayload({ ...base, issueDate: '14/11/2026' })).toThrow(/fecha/i)
    expect(() => buildAfipQrPayload({ ...base, recipientDocType: 'CUIT', recipientDocNumber: 'abc' })).toThrow(/numérico/)
  })
})
