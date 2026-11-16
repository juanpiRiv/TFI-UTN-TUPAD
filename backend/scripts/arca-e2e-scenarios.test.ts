import { describe, expect, it } from 'vitest'
import { isValidCuit } from '../src/lib/cuit.js'
import { buildScenarios, cuitWithCheckDigit, validCuitFrom } from './arca-e2e-scenarios.js'

const today = new Date('2026-11-15T12:00:00Z')

describe('escenarios del recorrido e2e de ARCA', () => {
  it('genera CUIT con dígito verificador válido para el validador del backend', () => {
    expect(isValidCuit(validCuitFrom('3071234560'))).toBe(true)
    expect(isValidCuit(validCuitFrom('2077654320'))).toBe(true)
    expect(cuitWithCheckDigit('123')).toBeUndefined()
  })

  it('basic es el escenario por defecto de un solo grupo y no usa receptor ni fechas', () => {
    const [scenario, ...rest] = buildScenarios(['basic'], today)
    expect(rest).toHaveLength(0)
    expect(scenario?.concept).toBe('PRODUCTOS')
    expect(scenario?.receiver).toBeUndefined()
    expect(scenario?.serviceDates).toBeUndefined()
  })

  it('services informa período del servicio y vencimiento del pago', () => {
    const [scenario] = buildScenarios(['services'], today)
    expect(scenario?.concept).toBe('SERVICIOS')
    expect(scenario?.serviceDates).toEqual({ serviceFrom: '2026-10-17', serviceTo: '2026-11-15', paymentDueDate: '2026-11-25' })
  })

  it('receiver cubre CUIT RI, CUIT Monotributo, DNI y servicios a un CUIT, con CUIT válidos', () => {
    const scenarios = buildScenarios(['receiver'], today)
    expect(scenarios.map((s) => [s.receiver?.docType, s.receiver?.taxCondition, s.expectedInArca.receiverVatConditionId])).toEqual([
      ['CUIT', 'RESPONSABLE_INSCRIPTO', 1],
      ['CUIT', 'MONOTRIBUTO', 6],
      ['DNI', 'CONSUMIDOR_FINAL', 5],
      ['CUIT', 'RESPONSABLE_INSCRIPTO', 1],
    ])
    for (const s of scenarios) if (s.receiver?.docType === 'CUIT') expect(isValidCuit(s.receiver.docNumber)).toBe(true)
  })

  it('acepta el nombre de un escenario suelto e ignora los desconocidos', () => {
    expect(buildScenarios(['receiver-cuit-monotributo', 'nada'], today).map((s) => s.name)).toEqual(['receiver-cuit-monotributo'])
  })
})
