import { createHash } from 'node:crypto'
import type {
  CaeRequest,
  CaeResult,
  FiscalMessage,
  FiscalProvider,
  LastAuthorizedParams,
} from '../fiscal-provider.js'
import { serviceDatesError } from '../service-dates.js'

/**
 * Leyenda obligatoria para mostrar en pantalla y en el PDF de todo comprobante
 * producido por este cliente.
 */
export const SIMULATED_WATERMARK = 'COMPROBANTE DE PRUEBA - SIN VALIDEZ FISCAL'

/**
 * Los codigos de este rango son INVENTADOS por el simulador. No son codigos de
 * ARCA ni representan ningun codigo de error o de observacion real.
 */
export const SIM_CODES = {
  observation: 90001,
  rejection: 90002,
  invalidAmount: 90003,
  nonConsecutive: 90004,
  invalidRequest: 90005,
  timeout: 90006,
} as const

export type SimulatedScenario = 'AUTHORIZED' | 'WITH_OBSERVATIONS' | 'REJECTED' | 'TIMEOUT'

export interface ArcaSimulatedClientOptions {
  /** Escenario por defecto. Si no se indica: AUTHORIZED. */
  scenario?: SimulatedScenario
  /** Si se define, decide el escenario de cada pedido (tiene prioridad sobre `scenario`). */
  scenarioFor?: (request: CaeRequest) => SimulatedScenario
  /**
   * En TIMEOUT: si el comprobante queda registrado "del otro lado" aunque la
   * respuesta no llegue. Permite probar la reconciliacion. Default: false.
   */
  timeoutRegistersVoucher?: boolean
  /** Si es false, healthCheck informa ok:false. Default: true. */
  healthy?: boolean
}

const DECIMAL = /^\d+\.\d{2}$/
const DATE = /^\d{8}$/
const EXPIRATION_DAYS = 10 // arbitrario del simulador, no es una regla de ARCA

function sequenceKey(p: { cuit: string; pointOfSale: number; voucherType: number }): string {
  return `${p.cuit}|${p.pointOfSale}|${p.voucherType}`
}

function deterministicCae(request: CaeRequest): string {
  const digest = createHash('sha256')
    .update(
      [
        request.idempotencyKey,
        request.cuit,
        request.pointOfSale,
        request.voucherType,
        request.voucherNumber,
        request.totalAmount,
      ].join('|'),
    )
    .digest()
  // 14 digitos derivados del hash: mismo pedido => mismo CAE ficticio.
  let digits = ''
  for (const byte of digest) {
    digits += String(byte % 10)
    if (digits.length === 14) break
  }
  return digits
}

function addDays(yyyymmdd: string, days: number): string {
  const y = Number(yyyymmdd.slice(0, 4))
  const m = Number(yyyymmdd.slice(4, 6))
  const d = Number(yyyymmdd.slice(6, 8))
  const date = new Date(Date.UTC(y, m - 1, d + days))
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(date.getUTCFullYear(), 4)}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
}

function validDate(yyyymmdd: string): boolean {
  if (!DATE.test(yyyymmdd)) return false
  return addDays(yyyymmdd, 0) === yyyymmdd
}

function sim(message: string): string {
  return `[SIMULADO] ${message}`
}

/**
 * Proveedor fiscal simulado. NO habla con ARCA. Todo resultado lleva
 * simulated:true y la leyenda SIMULATED_WATERMARK en `raw`.
 * Las reglas (consecutividad, vencimiento, codigos) son del simulador y NO
 * estan verificadas contra la documentacion oficial de ARCA.
 */
export class ArcaSimulatedClient implements FiscalProvider {
  readonly name = 'ArcaSimulatedClient'

  private scenario: SimulatedScenario
  private readonly scenarioFor: ((request: CaeRequest) => SimulatedScenario) | undefined
  private readonly timeoutRegistersVoucher: boolean
  private healthy: boolean

  private readonly lastByKey = new Map<string, number>()
  private readonly resultsByIdempotency = new Map<string, CaeResult>()
  /** Comprobantes registrados pese a un timeout, a la espera de que se reintente. */
  private readonly registeredAfterTimeout = new Map<string, CaeResult>()

  constructor(options: ArcaSimulatedClientOptions = {}) {
    this.scenario = options.scenario ?? 'AUTHORIZED'
    this.scenarioFor = options.scenarioFor
    this.timeoutRegistersVoucher = options.timeoutRegistersVoucher ?? false
    this.healthy = options.healthy ?? true
  }

  setScenario(scenario: SimulatedScenario): void {
    this.scenario = scenario
  }

  setHealthy(healthy: boolean): void {
    this.healthy = healthy
  }

  async healthCheck(): Promise<{ ok: boolean; detail: string }> {
    return this.healthy
      ? { ok: true, detail: sim('cliente simulado operativo; no se consulto a ARCA') }
      : { ok: false, detail: sim('cliente simulado configurado como no disponible') }
  }

  async getLastAuthorized(params: LastAuthorizedParams): Promise<{ voucherNumber: number }> {
    return { voucherNumber: this.lastByKey.get(sequenceKey(params)) ?? 0 }
  }

  async requestCae(request: CaeRequest): Promise<CaeResult> {
    const cached = this.resultsByIdempotency.get(request.idempotencyKey)
    if (cached) return structuredClone(cached)

    const registered = this.registeredAfterTimeout.get(request.idempotencyKey)
    if (registered) {
      this.registeredAfterTimeout.delete(request.idempotencyKey)
      this.resultsByIdempotency.set(request.idempotencyKey, registered)
      return structuredClone(registered)
    }

    const invalid = this.validate(request)
    if (invalid) return this.remember(request, this.rejected([invalid], request))

    const seqKey = sequenceKey(request)
    const expected = (this.lastByKey.get(seqKey) ?? 0) + 1
    if (request.voucherNumber !== expected) {
      return this.remember(
        request,
        this.rejected(
          [
            {
              code: SIM_CODES.nonConsecutive,
              message: sim(`numero no consecutivo: se esperaba ${expected} y llego ${request.voucherNumber}`),
            },
          ],
          request,
        ),
      )
    }

    const scenario = this.scenarioFor ? this.scenarioFor(request) : this.scenario

    switch (scenario) {
      case 'REJECTED':
        return this.remember(
          request,
          this.rejected([{ code: SIM_CODES.rejection, message: sim('rechazo simulado') }], request),
        )
      case 'TIMEOUT': {
        if (this.timeoutRegistersVoucher) {
          this.lastByKey.set(seqKey, request.voucherNumber)
          this.registeredAfterTimeout.set(request.idempotencyKey, this.authorized(request, false))
        }
        // No se cachea: un reintento con la misma clave debe poder resolverse.
        return {
          outcome: 'INDETERMINATE',
          observations: [],
          errors: [
            { code: SIM_CODES.timeout, message: sim('timeout simulado: no se sabe si el comprobante quedo registrado') },
          ],
          simulated: true,
          raw: { watermark: SIMULATED_WATERMARK, scenario },
        }
      }
      case 'WITH_OBSERVATIONS':
        this.lastByKey.set(seqKey, request.voucherNumber)
        return this.remember(request, this.authorized(request, true))
      case 'AUTHORIZED':
      default:
        this.lastByKey.set(seqKey, request.voucherNumber)
        return this.remember(request, this.authorized(request, false))
    }
  }

  private validate(request: CaeRequest): FiscalMessage | null {
    for (const [field, value] of [
      ['netAmount', request.netAmount],
      ['ivaAmount', request.ivaAmount],
      ['totalAmount', request.totalAmount],
    ] as const) {
      if (typeof value !== 'string' || !DECIMAL.test(value)) {
        return { code: SIM_CODES.invalidAmount, message: sim(`${field} debe ser un decimal con 2 decimales`) }
      }
    }
    if (!validDate(request.voucherDate)) {
      return { code: SIM_CODES.invalidRequest, message: sim('voucherDate debe ser una fecha YYYYMMDD valida') }
    }
    const datesError = serviceDatesError(request)
    if (datesError !== undefined) return { code: SIM_CODES.invalidRequest, message: sim(datesError) }
    if (!request.idempotencyKey) {
      return { code: SIM_CODES.invalidRequest, message: sim('idempotencyKey es obligatoria') }
    }
    if (!Number.isInteger(request.voucherNumber) || request.voucherNumber < 1) {
      return { code: SIM_CODES.invalidRequest, message: sim('voucherNumber debe ser un entero positivo') }
    }
    return null
  }

  private authorized(request: CaeRequest, withObservations: boolean): CaeResult {
    const observations: FiscalMessage[] = withObservations
      ? [{ code: SIM_CODES.observation, message: sim('observacion simulada, el comprobante igual queda autorizado') }]
      : []
    return {
      outcome: withObservations ? 'AUTHORIZED_WITH_OBSERVATIONS' : 'AUTHORIZED',
      cae: deterministicCae(request),
      caeExpiration: addDays(request.voucherDate, EXPIRATION_DAYS),
      observations,
      errors: [],
      simulated: true,
      raw: { watermark: SIMULATED_WATERMARK, voucherNumber: request.voucherNumber },
    }
  }

  private rejected(errors: FiscalMessage[], request: CaeRequest): CaeResult {
    return {
      outcome: 'REJECTED',
      observations: [],
      errors,
      simulated: true,
      raw: { watermark: SIMULATED_WATERMARK, voucherNumber: request.voucherNumber },
    }
  }

  private remember(request: CaeRequest, result: CaeResult): CaeResult {
    if (request.idempotencyKey) this.resultsByIdempotency.set(request.idempotencyKey, result)
    return structuredClone(result)
  }
}
