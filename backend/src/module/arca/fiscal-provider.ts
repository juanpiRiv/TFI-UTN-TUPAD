// Contrato común de los proveedores fiscales (ARCA real, SDK y simulado). Decisión nuestra, no de ARCA.
export type FiscalOutcome = 'AUTHORIZED' | 'AUTHORIZED_WITH_OBSERVATIONS' | 'REJECTED' | 'INDETERMINATE'

export interface FiscalMessage {
  code: number
  message: string
}

export interface LastAuthorizedParams {
  cuit: string
  pointOfSale: number
  voucherType: number
}

export interface CaeRequest {
  cuit: string
  pointOfSale: number
  voucherType: number
  concept: number
  docType: number
  docNumber: string
  receiverIvaConditionId: number
  voucherNumber: number
  voucherDate: string // YYYYMMDD
  netAmount: string // decimal como string, ej "1000.00"
  ivaAmount: string
  totalAmount: string
  currency: string // codigo ARCA, ej "PES"
  exchangeRate: string
  idempotencyKey: string
}

export interface CaeResult {
  outcome: FiscalOutcome
  cae?: string
  caeExpiration?: string // YYYYMMDD
  observations: FiscalMessage[]
  errors: FiscalMessage[]
  simulated: boolean
  raw?: unknown
}

export interface FiscalProvider {
  readonly name: string
  healthCheck(): Promise<{ ok: boolean; detail: string }>
  getLastAuthorized(params: LastAuthorizedParams): Promise<{ voucherNumber: number }>
  requestCae(request: CaeRequest): Promise<CaeResult>
}
// Los codigos concretos (tipo de comprobante, docType, condicion IVA del receptor, concepto) se verifican contra la doc oficial antes de usarlos.
