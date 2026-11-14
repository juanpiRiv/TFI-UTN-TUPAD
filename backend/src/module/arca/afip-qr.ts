/**
 * Código QR de los comprobantes electrónicos (RG 4892 de ARCA).
 *
 * El QR codifica una URL: `https://www.afip.gob.ar/fe/qr/?p=` seguido del JSON del comprobante en base64.
 * Con el QR, quien recibe el comprobante puede verificarlo en el sitio de ARCA.
 */
export const AFIP_QR_BASE_URL = 'https://www.afip.gob.ar/fe/qr/'

type DocType = 'CUIT' | 'CUIL' | 'DNI' | 'PASAPORTE' | 'SIN_IDENTIFICAR'

// Códigos de tipo de documento del receptor, los mismos que usa el pedido de CAE.
const DOC_TYPE_CODE: Record<DocType, number> = { CUIT: 80, CUIL: 86, DNI: 96, PASAPORTE: 94, SIN_IDENTIFICAR: 99 }

export interface AfipQrInput {
  /** Fecha de emisión, YYYY-MM-DD. */
  issueDate: string
  /** CUIT del emisor, 11 dígitos. */
  issuerCuit: string
  pointOfSale: number
  /** Código del tipo de comprobante: 11 es Factura C. */
  voucherTypeCode: number
  voucherNumber: number
  /** Importe total con hasta 2 decimales, como texto. */
  total: string
  currency: 'ARS' | 'USD'
  exchangeRate: string
  recipientDocType: DocType | null
  recipientDocNumber: string | null
  /** CAE como lo devolvió ARCA. */
  cae: string
}

export interface AfipQrPayload {
  ver: 1
  fecha: string
  cuit: number
  ptoVta: number
  tipoCmp: number
  nroCmp: number
  importe: number
  moneda: 'PES' | 'DOL'
  ctz: number
  tipoDocRec: number
  nroDocRec: number
  tipoCodAut: 'E'
  codAut: number
}

/** Arma el contenido del QR. Lanza si falta algún dato que el comprobante autorizado debe tener. */
export function buildAfipQrPayload(input: AfipQrInput): AfipQrPayload {
  if (!/^\d{11}$/.test(input.issuerCuit)) throw new Error('El CUIT del emisor tiene que tener 11 dígitos')
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.issueDate)) throw new Error('La fecha tiene que ser YYYY-MM-DD')
  if (!/^\d{14}$/.test(input.cae)) throw new Error('El CAE tiene que tener 14 dígitos')

  const docType = input.recipientDocType ?? 'SIN_IDENTIFICAR'
  const docNumber = docType === 'SIN_IDENTIFICAR' ? 0 : Number(input.recipientDocNumber)
  if (!Number.isFinite(docNumber)) throw new Error('El documento del receptor tiene que ser numérico')

  return {
    ver: 1,
    fecha: input.issueDate,
    cuit: Number(input.issuerCuit),
    ptoVta: input.pointOfSale,
    tipoCmp: input.voucherTypeCode,
    nroCmp: input.voucherNumber,
    importe: Number(input.total),
    moneda: input.currency === 'ARS' ? 'PES' : 'DOL',
    ctz: Number(input.exchangeRate),
    tipoDocRec: DOC_TYPE_CODE[docType],
    nroDocRec: docNumber,
    tipoCodAut: 'E',
    codAut: Number(input.cae),
  }
}

/** URL que va dentro del QR. */
export function buildAfipQrUrl(input: AfipQrInput): string {
  const json = JSON.stringify(buildAfipQrPayload(input))
  return `${AFIP_QR_BASE_URL}?p=${Buffer.from(json, 'utf8').toString('base64')}`
}
