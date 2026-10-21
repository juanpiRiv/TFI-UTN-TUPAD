import { createArcaClient, type ArcaClient, type WsfeVoucherInput } from 'facturas'
import type { CaeRequest, CaeResult, FiscalProvider, LastAuthorizedParams } from '../fiscal-provider.js'
import { decimalStringToCents, centsToSdkNumber } from './amounts.js'
import { ArcaSdkInputError } from './errors.js'
import { mapAuthorizationOutcome, wrapSdkError } from './mapping.js'

export type ArcaSdkLogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface ArcaSdkClientOptions {
  /** CUIT del emisor (11 digitos). Tiene que coincidir con el del certificado. */
  cuit: string
  certificatePem: string
  privateKeyPem: string
  /** 'test' = homologacion. Por defecto 'test'. */
  environment?: 'test' | 'production'
  timeoutMs?: number
  /** Sumidero de logs del SDK. Por defecto se descartan (el SDK imprime por consola si no). */
  log?: (level: ArcaSdkLogLevel, message: string, ...args: unknown[]) => void
  /** Solo para tests: reemplaza la construccion del cliente del SDK. */
  clientFactory?: (config: Parameters<typeof createArcaClient>[0]) => ArcaClient
}

const CUIT = /^\d{11}$/
const YYYYMMDD = /^\d{8}$/
const CURRENCY = /^[A-Z]{3}$/

function requireInt(value: number, field: string, min = 0): number {
  if (!Number.isSafeInteger(value) || value < min) {
    throw new ArcaSdkInputError(`${field} tiene que ser un entero >= ${min}`, { field })
  }
  return value
}

/**
 * FiscalProvider sobre la libreria `facturas`. Usa la API de bajo nivel (`client.wsfe.*`) y no
 * `client.issue()`: el numero de comprobante lo decide el dominio (CaeRequest.voucherNumber) y
 * no se delega numeracion, reservas ni idempotencia al SDK.
 *
 * `CaeRequest.idempotencyKey` NO se usa en este camino: wsfe.issue() no tiene idempotencia.
 * La unicidad hay que resolverla en el dominio (por ejemplo, reservar el numero antes de llamar
 * y, ante INDETERMINATE, consultar el comprobante antes de reintentar).
 */
export class ArcaSdkClient implements FiscalProvider {
  readonly name = 'arca-sdk(facturas)'
  private readonly client: ArcaClient
  private readonly cuit: string

  constructor(options: ArcaSdkClientOptions) {
    if (!CUIT.test(options.cuit)) throw new ArcaSdkInputError('cuit tiene que tener 11 digitos', { field: 'cuit' })
    this.cuit = options.cuit
    const sink = options.log ?? (() => {})
    const config = {
      taxId: options.cuit,
      certificatePem: options.certificatePem,
      privateKeyPem: options.privateKeyPem,
      environment: options.environment ?? 'test',
      ...(options.timeoutMs === undefined ? {} : { timeout: options.timeoutMs }),
      logger: { log: sink },
    } as const
    try {
      this.client = (options.clientFactory ?? createArcaClient)(config)
    } catch (error) {
      throw wrapSdkError(error)
    }
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    // FEDummy: no requiere autenticacion (Manual WSFEv1 V4.8, PDF p.125; confirmado con respuesta real).
    try {
      const s = await this.client.wsfe.getServerStatus()
      const ok = s.appServer === 'OK' && s.dbServer === 'OK' && s.authServer === 'OK'
      return { ok, detail: `AppServer=${s.appServer} DbServer=${s.dbServer} AuthServer=${s.authServer}` }
    } catch (error) {
      const e = wrapSdkError(error)
      return { ok: false, detail: `${e.kind}: ${e.message}` }
    }
  }

  async getLastAuthorized(params: LastAuthorizedParams): Promise<{ voucherNumber: number }> {
    this.assertCuit(params.cuit)
    requireInt(params.pointOfSale, 'pointOfSale', 1)
    requireInt(params.voucherType, 'voucherType', 1)
    try {
      // El SDK expone "proximo numero" (FECompUltimoAutorizado + 1); se resta 1 para devolver el ultimo.
      const next = await this.client.wsfe.getNextVoucherNumber({
        representedTaxId: params.cuit,
        salesPoint: params.pointOfSale,
        voucherType: params.voucherType,
      })
      return { voucherNumber: next - 1 }
    } catch (error) {
      throw wrapSdkError(error)
    }
  }

  async requestCae(request: CaeRequest): Promise<CaeResult> {
    const data = this.toVoucherInput(request)
    try {
      const outcome = await this.client.wsfe.issue({
        representedTaxId: request.cuit,
        voucherNumber: requireInt(request.voucherNumber, 'voucherNumber', 1),
        data,
      })
      return mapAuthorizationOutcome(outcome)
    } catch (error) {
      // wsfe.issue() devuelve `indeterminate` en vez de lanzar; solo lanza por validacion local previa al envio.
      throw wrapSdkError(error)
    }
  }

  private assertCuit(cuit: string): void {
    if (!CUIT.test(cuit)) throw new ArcaSdkInputError('cuit tiene que tener 11 digitos', { field: 'cuit' })
    if (cuit !== this.cuit) {
      throw new ArcaSdkInputError('cuit distinto del configurado en el cliente (el certificado es de otro CUIT)', {
        field: 'cuit',
      })
    }
  }

  private toVoucherInput(r: CaeRequest): WsfeVoucherInput {
    this.assertCuit(r.cuit)
    if (!YYYYMMDD.test(r.voucherDate)) throw new ArcaSdkInputError('voucherDate tiene que ser YYYYMMDD', { field: 'voucherDate' })
    if (!CURRENCY.test(r.currency)) throw new ArcaSdkInputError('currency tiene que ser un codigo de 3 letras', { field: 'currency' })
    if (!/^\d{1,11}$/.test(r.docNumber)) throw new ArcaSdkInputError('docNumber tiene que ser numerico (hasta 11 digitos)', { field: 'docNumber' })

    const net = decimalStringToCents(r.netAmount, 'netAmount')
    const iva = decimalStringToCents(r.ivaAmount, 'ivaAmount')
    const total = decimalStringToCents(r.totalAmount, 'totalAmount')
    // No se calcula ni se corrige nada: lo que llega es lo que se informa. La coherencia total = neto + IVA
    // se deja a la validacion del SDK y a la de ARCA (validacion 10048, Manual V4.8 PDF p.48-49).
    return {
      salesPoint: requireInt(r.pointOfSale, 'pointOfSale', 1),
      voucherType: requireInt(r.voucherType, 'voucherType', 1),
      concept: requireInt(r.concept, 'concept', 1),
      documentType: requireInt(r.docType, 'docType', 0),
      documentNumber: Number(r.docNumber),
      receiverVatConditionId: requireInt(r.receiverIvaConditionId, 'receiverIvaConditionId', 1),
      voucherDate: r.voucherDate as WsfeVoucherInput['voucherDate'],
      totalAmount: centsToSdkNumber(total),
      nonTaxableAmount: 0,
      netAmount: centsToSdkNumber(net),
      exemptAmount: 0,
      taxAmount: 0,
      vatAmount: centsToSdkNumber(iva),
      currencyId: r.currency,
      exchangeRate: r.exchangeRate,
    }
  }
}
