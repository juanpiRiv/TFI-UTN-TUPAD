import type { CaeRequest } from './fiscal-provider.js'

type DocType = 'CUIT' | 'CUIL' | 'DNI' | 'PASAPORTE' | 'SIN_IDENTIFICAR'
type TaxCondition = 'RESPONSABLE_INSCRIPTO' | 'MONOTRIBUTO' | 'EXENTO' | 'CONSUMIDOR_FINAL'
type Concept = 'PRODUCTOS' | 'SERVICIOS' | 'PRODUCTOS_Y_SERVICIOS'

/** Lo mínimo de una factura que hace falta para pedir el CAE. */
export interface InvoiceForCae {
  id: number
  voucherType: 'FACTURA_C' | 'NOTA_DEBITO_C' | 'NOTA_CREDITO_C'
  concept: Concept
  issueDate: Date
  serviceFrom: Date | null
  serviceTo: Date | null
  paymentDueDate: Date | null
  recipientDocType: DocType | null
  recipientDocNumber: string | null
  recipientTaxCondition: TaxCondition | null
  currency: 'ARS' | 'USD'
  fiscalExchangeRate: { toString(): string } | string
  totalAmount: { toString(): string } | string
}

export interface BuildCaeRequestInput {
  cuit: string
  pointOfSaleNumber: number
  voucherNumber: number
  invoice: InvoiceForCae
}

// Códigos de comprobante y documento: los de los comentarios de backend/prisma/schema/enums.prisma.
const FACTURA_C = 11
const CONCEPT: Record<Concept, number> = { PRODUCTOS: 1, SERVICIOS: 2, PRODUCTOS_Y_SERVICIOS: 3 }
const DOC_TYPE: Record<DocType, number> = { CUIT: 80, CUIL: 86, DNI: 96, PASAPORTE: 94, SIN_IDENTIFICAR: 99 }
// Condición frente al IVA del receptor (CondicionIVAReceptorId). NO verificados contra el catálogo de
// ARCA (FEParamGetCondicionIvaReceptor): se confirman en la prueba real de #138 y #137.
const RECEIVER_IVA: Record<TaxCondition, number> = {
  RESPONSABLE_INSCRIPTO: 1,
  EXENTO: 4,
  CONSUMIDOR_FINAL: 5,
  MONOTRIBUTO: 6,
}

const yyyymmdd = (date: Date) => date.toISOString().slice(0, 10).replaceAll('-', '')
const optionalDate = (date: Date | null) => (date ? yyyymmdd(date) : undefined)

/**
 * Arma el pedido de CAE de una Factura C a partir de la factura. Los ítems no viajan: ARCA recibe solo
 * los totales (neto = total, IVA = 0 en Factura C). Solo pesos y Factura C en el P0 (docs/04, regla 10).
 */
export function buildCaeRequest({ cuit, pointOfSaleNumber, voucherNumber, invoice }: BuildCaeRequestInput): CaeRequest {
  if (invoice.voucherType !== 'FACTURA_C') {
    throw new Error(`Por ahora solo se emite Factura C (recibido: ${invoice.voucherType})`)
  }
  if (invoice.currency !== 'ARS') {
    throw new Error(`Por ahora se factura solo pesos (recibido: ${invoice.currency})`)
  }

  const docType = invoice.recipientDocType ?? 'SIN_IDENTIFICAR'
  const taxCondition = invoice.recipientTaxCondition ?? 'CONSUMIDOR_FINAL'
  const total = Number(invoice.totalAmount.toString()).toFixed(2)
  const serviceStartDate = optionalDate(invoice.serviceFrom)
  const serviceEndDate = optionalDate(invoice.serviceTo)
  const paymentDueDate = optionalDate(invoice.paymentDueDate)

  return {
    cuit,
    pointOfSale: pointOfSaleNumber,
    voucherType: FACTURA_C,
    concept: CONCEPT[invoice.concept],
    ...(serviceStartDate ? { serviceStartDate } : {}),
    ...(serviceEndDate ? { serviceEndDate } : {}),
    ...(paymentDueDate ? { paymentDueDate } : {}),
    docType: DOC_TYPE[docType],
    docNumber: invoice.recipientDocNumber ?? '0',
    receiverIvaConditionId: RECEIVER_IVA[taxCondition],
    voucherNumber,
    voucherDate: yyyymmdd(invoice.issueDate),
    netAmount: total,
    ivaAmount: '0.00',
    totalAmount: total,
    currency: 'PES',
    exchangeRate: Number(invoice.fiscalExchangeRate.toString()).toFixed(6),
    idempotencyKey: `invoice-${invoice.id}`,
  }
}
