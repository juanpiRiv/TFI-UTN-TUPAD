import type { CaeRequest } from './fiscal-provider.js'

const SERVICE_CONCEPTS = [2, 3]

function isValidDate(yyyymmdd: string): boolean {
  if (!/^\d{8}$/.test(yyyymmdd)) return false
  const y = Number(yyyymmdd.slice(0, 4))
  const m = Number(yyyymmdd.slice(4, 6))
  const d = Number(yyyymmdd.slice(6, 8))
  const date = new Date(Date.UTC(y, m - 1, d))
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}

/**
 * Valida las fechas de servicio del pedido. Si el concepto incluye servicios (2 o 3) hay que informar el
 * periodo del servicio y el vencimiento del pago (docs/04-factura-cobro-y-pagos.md). Devuelve el motivo del
 * rechazo o `undefined` si el pedido esta bien. Para el concepto 1 no se exige nada.
 */
export function serviceDatesError(request: CaeRequest): string | undefined {
  if (!SERVICE_CONCEPTS.includes(request.concept)) return undefined
  const fields = [
    ['serviceStartDate', request.serviceStartDate],
    ['serviceEndDate', request.serviceEndDate],
    ['paymentDueDate', request.paymentDueDate],
  ] as const
  for (const [name, value] of fields) {
    if (value === undefined) return `${name} es obligatoria cuando el concepto incluye servicios`
    if (!isValidDate(value)) return `${name} debe ser una fecha YYYYMMDD valida`
  }
  if ((request.serviceStartDate as string) > (request.serviceEndDate as string)) {
    return 'serviceStartDate no puede ser posterior a serviceEndDate'
  }
  return undefined
}
