/** Escenarios del recorrido `pnpm arca:e2e`: qué factura se arma y qué tiene que devolver ARCA. */

const CUIT_WEIGHTS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]

/** Completa un prefijo de 10 dígitos con el dígito verificador del CUIT; devuelve `undefined` si ese prefijo no admite uno. */
export function cuitWithCheckDigit(prefix10: string): string | undefined {
  if (!/^\d{10}$/.test(prefix10)) return undefined
  const sum = CUIT_WEIGHTS.reduce((total, weight, index) => total + weight * Number(prefix10[index]), 0)
  const remainder = 11 - (sum % 11)
  const digit = remainder === 11 ? 0 : remainder
  return digit === 10 ? undefined : `${prefix10}${digit}`
}

/** Primer CUIT válido a partir de un prefijo base (se incrementa el cuerpo hasta que el dígito verificador exista). */
export function validCuitFrom(base: string): string {
  const start = Number(base.slice(0, 10))
  for (let offset = 0; offset < 100; offset += 1) {
    const cuit = cuitWithCheckDigit(String(start + offset).padStart(10, '0'))
    if (cuit) return cuit
  }
  throw new Error('No se pudo generar un CUIT válido')
}

export type TaxConditionName = 'RESPONSABLE_INSCRIPTO' | 'MONOTRIBUTO' | 'EXENTO' | 'CONSUMIDOR_FINAL'

export interface Scenario {
  name: string
  description: string
  concept: 'PRODUCTOS' | 'SERVICIOS' | 'PRODUCTOS_Y_SERVICIOS'
  serviceDates?: { serviceFrom: string; serviceTo: string; paymentDueDate: string }
  receiver?: { name: string; docType: 'CUIT' | 'DNI'; docNumber: string; taxCondition: TaxConditionName }
  /** Lo que ARCA tiene que devolver en FECompConsultar. */
  expectedInArca: { concept: number; documentType: number; receiverVatConditionId: number; hasServiceDates: boolean }
}

const isoDay = (date: Date, shiftDays = 0) => {
  const copy = new Date(date.getTime() + shiftDays * 86_400_000)
  return copy.toISOString().slice(0, 10)
}

/** Arma los escenarios pedidos. Los nombres desconocidos se ignoran. */
export function buildScenarios(requested: string[], today: Date): Scenario[] {
  const serviceDates = { serviceFrom: isoDay(today, -29), serviceTo: isoDay(today), paymentDueDate: isoDay(today, 10) }
  // CUIT y DNI ficticios y fijos: así el cliente se reutiliza al repetir el recorrido.
  const cuitRi = validCuitFrom('3071234560')
  // ARCA valida el CUIT del receptor contra el padrón (10015 si no está registrado) y no admite el del emisor (10069):
  // un CUIT inventado con dígito verificador válido no siempre alcanza. Para el Monotributo se usa el CUIT público
  // de la propia ARCA, que está en el padrón; el de Responsable Inscripto generado en el repositorio fue aceptado.
  const cuitMono = '33693450239'
  const all: Record<string, Scenario[]> = {
    basic: [
      {
        name: 'basic',
        description: 'Prueba de homologación',
        concept: 'PRODUCTOS',
        expectedInArca: { concept: 1, documentType: 99, receiverVatConditionId: 5, hasServiceDates: false },
      },
    ],
    services: [
      {
        name: 'services',
        description: 'Servicio de prueba de homologación',
        concept: 'SERVICIOS',
        serviceDates,
        expectedInArca: { concept: 2, documentType: 99, receiverVatConditionId: 5, hasServiceDates: true },
      },
    ],
    receiver: [
      {
        name: 'receiver-cuit-ri',
        description: 'Prueba a Responsable Inscripto',
        concept: 'PRODUCTOS',
        receiver: { name: 'Receptor RI de prueba', docType: 'CUIT', docNumber: cuitRi, taxCondition: 'RESPONSABLE_INSCRIPTO' },
        expectedInArca: { concept: 1, documentType: 80, receiverVatConditionId: 1, hasServiceDates: false },
      },
      {
        name: 'receiver-cuit-monotributo',
        description: 'Prueba a Monotributo',
        concept: 'PRODUCTOS',
        receiver: { name: 'Receptor Monotributo de prueba', docType: 'CUIT', docNumber: cuitMono, taxCondition: 'MONOTRIBUTO' },
        expectedInArca: { concept: 1, documentType: 80, receiverVatConditionId: 6, hasServiceDates: false },
      },
      {
        name: 'receiver-dni-consumidor-final',
        description: 'Prueba a consumidor final con DNI',
        concept: 'PRODUCTOS',
        receiver: { name: 'Consumidor final de prueba', docType: 'DNI', docNumber: '30123456', taxCondition: 'CONSUMIDOR_FINAL' },
        expectedInArca: { concept: 1, documentType: 96, receiverVatConditionId: 5, hasServiceDates: false },
      },
      {
        name: 'receiver-services-cuit-ri',
        description: 'Servicio a Responsable Inscripto',
        concept: 'SERVICIOS',
        serviceDates,
        receiver: { name: 'Receptor RI de prueba', docType: 'CUIT', docNumber: cuitRi, taxCondition: 'RESPONSABLE_INSCRIPTO' },
        expectedInArca: { concept: 2, documentType: 80, receiverVatConditionId: 1, hasServiceDates: true },
      },
    ],
  }
  // Se admite el grupo (`receiver`) o el nombre de un escenario suelto (`receiver-cuit-monotributo`).
  const everyScenario = Object.values(all).flat()
  return requested.flatMap((name) => all[name] ?? everyScenario.filter((scenario) => scenario.name === name))
}
