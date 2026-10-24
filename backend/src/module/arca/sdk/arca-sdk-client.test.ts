/**
 * Tests de ArcaSdkClient.
 *
 * Todo lo que dice "SIMULACION LOCAL" corre contra un servidor SOAP local (testing/soap-sim.ts) armado a partir
 * de los WSDL oficiales de homologacion. NO es evidencia de como responde ARCA. Las respuestas reales de
 * homologacion estan capturadas aparte (docs/arca/respuestas-reales/) y el bloque final las puede repetir con
 * ARCA_REAL_TESTS=1.
 */
import { execFileSync } from 'node:child_process'
import http from 'node:http'
import https from 'node:https'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { CaeRequest } from '../fiscal-provider.js'
import { centsToSdkNumber, decimalStringToCents } from './amounts.js'
import { ArcaSdkClient } from './arca-sdk-client.js'
import { ArcaSdkError, ArcaSdkInputError } from './errors.js'
import { runFiscalProviderContract } from '../contract/fiscal-provider.contract.js'
import { startSoapSim, type SoapSim } from './testing/soap-sim.js'

const CUIT_FALSO = '20000000001'

function hasOpenssl(): boolean {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

function baseRequest(over: Partial<CaeRequest> = {}): CaeRequest {
  // Valores del Manual WSFEv1 V4.8 (consultado 2026-10-19): Concepto 1 = Productos (PDF p.25), DocTipo 80 = CUIT
  // (ejemplo PDF p.79), CondicionIVAReceptorId 5 = Consumidor Final (tabla PDF p.202), moneda PES con cotizacion 1
  // (PDF p.30), tipo 11 pertenece a los comprobantes clase C (validacion 10007, PDF p.40).
  // El NOMBRE de cada codigo ("Factura C") sale de FEParamGetTiposCbte: NO VERIFICADO sin Ticket de Acceso.
  return {
    cuit: CUIT_FALSO,
    pointOfSale: 1,
    voucherType: 11,
    concept: 1,
    docType: 80,
    docNumber: '20000000002',
    receiverIvaConditionId: 5,
    voucherNumber: 42,
    voucherDate: '20261019',
    netAmount: '1000.00',
    ivaAmount: '0.00',
    totalAmount: '1000.00',
    currency: 'PES',
    exchangeRate: '1',
    idempotencyKey: 'clave-de-prueba-1',
    ...over,
  }
}

describe.skipIf(!hasOpenssl())('ArcaSdkClient contra SIMULACION LOCAL', () => {
  let sim: SoapSim
  let dir: string
  let cert: string
  let key: string
  let requestSpy: ReturnType<typeof vi.spyOn>

  beforeAll(async () => {
    // Certificado autofirmado de prueba con CUIT falso, generado fuera del repo y descartado al terminar.
    dir = mkdtempSync(join(tmpdir(), 'arca-sdk-test-'))
    execFileSync(
      'openssl',
      [
        'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
        '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '2',
        '-subj', `/C=AR/O=Prueba/CN=autofirmado/serialNumber=CUIT ${CUIT_FALSO}`,
      ],
      { stdio: 'ignore' },
    )
    cert = readFileSync(join(dir, 'c.pem'), 'utf8')
    key = readFileSync(join(dir, 'k.pem'), 'utf8')
    sim = await startSoapSim()
  })

  afterAll(async () => {
    await sim.close()
    rmSync(dir, { recursive: true, force: true })
  })

  beforeEach(() => {
    sim.reset()
    // El SDK no permite cambiar el endpoint por configuracion: se redirige node:https.request al servidor local.
    requestSpy = vi.spyOn(https, 'request').mockImplementation(((options: https.RequestOptions, cb: (res: http.IncomingMessage) => void) =>
      http.request({ ...options, protocol: 'http:', hostname: '127.0.0.1', port: sim.port, agent: undefined }, cb)) as never)
  })

  afterEach(() => {
    requestSpy.mockRestore()
  })

  function client(timeoutMs = 5000): ArcaSdkClient {
    return new ArcaSdkClient({ cuit: CUIT_FALSO, certificatePem: cert, privateKeyPem: key, environment: 'test', timeoutMs })
  }

  const wsfeCalls = (op: string) => sim.state.requests.filter((r) => r.operation === op)

  runFiscalProviderContract('ArcaSdkClient (SIMULACION LOCAL)', {
    createHarness: () => ({
      provider: client(300),
      cuit: CUIT_FALSO,
      dedupesByKey: false,
      force: (scenario) => {
        sim.state.caeScenario = {
          AUTHORIZED: 'authorized',
          WITH_OBSERVATIONS: 'authorized_with_obs',
          REJECTED: 'rejected_detail',
          TIMEOUT: 'hang',
        }[scenario] as typeof sim.state.caeScenario
      },
    }),
  })

  describe('fechas de servicio (concepto 2 o 3)', () => {
    it('no llama a ARCA si faltan las fechas de un servicio', async () => {
      await expect(client().requestCae(baseRequest({ concept: 2 }))).rejects.toBeInstanceOf(ArcaSdkInputError)
      expect(wsfeCalls('FECAESolicitar')).toHaveLength(0)
    })

    it('informa el periodo del servicio y el vencimiento del pago a ARCA', async () => {
      const result = await client().requestCae(
        baseRequest({
          concept: 2,
          serviceStartDate: '20261001',
          serviceEndDate: '20261031',
          paymentDueDate: '20261110',
        }),
      )
      expect(result.outcome).toBe('AUTHORIZED')
      const body = wsfeCalls('FECAESolicitar')[0]?.body ?? ''
      expect(body).toContain('<FchServDesde>20261001</FchServDesde>')
      expect(body).toContain('<FchServHasta>20261031</FchServHasta>')
      expect(body).toContain('<FchVtoPago>20261110</FchVtoPago>')
    })

    it('para productos no manda fechas de servicio', async () => {
      await client().requestCae(baseRequest())
      const body = wsfeCalls('FECAESolicitar')[0]?.body ?? ''
      expect(body).not.toContain('FchServDesde')
    })
  })

  describe('healthCheck (FEDummy)', () => {
    it('ok sin autenticacion: no llama a WSAA', async () => {
      const r = await client().healthCheck()
      expect(r).toEqual({ ok: true, detail: 'AppServer=OK DbServer=OK AuthServer=OK' })
      expect(sim.state.wsaaLogins).toBe(0)
      expect(wsfeCalls('FEDummy')).toHaveLength(1)
    })

    it('no lanza si el servicio esta caido', async () => {
      sim.state.dummy = 'down'
      const r = await client().healthCheck()
      expect(r.ok).toBe(false)
      expect(r.detail).toContain('transport')
    })
  })

  describe('autenticacion WSAA', () => {
    it('arma un TRA para el servicio wsfe y manda un CMS en DER', async () => {
      await client().getLastAuthorized({ cuit: CUIT_FALSO, pointOfSale: 1, voucherType: 11 })
      const tra = sim.state.tra[0] ?? ''
      expect(tra).toContain('<service>wsfe</service>')
      expect(tra).toContain('<uniqueId>')
      expect(tra).toContain('<generationTime>')
      expect(tra).toContain('<expirationTime>')
      const login = sim.state.requests.find((r) => r.operation === 'loginCms')
      expect(login?.path).toBe('/ws/services/LoginCms')
    })

    it('reutiliza el Ticket de Acceso entre llamadas del mismo cliente', async () => {
      const c = client()
      await c.getLastAuthorized({ cuit: CUIT_FALSO, pointOfSale: 1, voucherType: 11 })
      await c.getLastAuthorized({ cuit: CUIT_FALSO, pointOfSale: 1, voucherType: 11 })
      await c.requestCae(baseRequest())
      expect(sim.state.wsaaLogins).toBe(1)
    })

    it('manda Auth con Token, Sign y Cuit a WSFE', async () => {
      await client().getLastAuthorized({ cuit: CUIT_FALSO, pointOfSale: 1, voucherType: 11 })
      const body = wsfeCalls('FECompUltimoAutorizado')[0]?.body ?? ''
      expect(body).toMatch(/<Token>TOKEN-SIMULADO-\d+<\/Token>/)
      expect(body).toMatch(/<Sign>SIGN-SIMULADO-\d+<\/Sign>/)
      expect(body).toContain(`<Cuit>${CUIT_FALSO}</Cuit>`)
    })

    it('un rechazo de WSAA al pedir el ultimo comprobante sale como error propio con faultCode', async () => {
      sim.state.wsaaMode = 'untrusted'
      const err = await client()
        .getLastAuthorized({ cuit: CUIT_FALSO, pointOfSale: 1, voucherType: 11 })
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ArcaSdkError)
      expect((err as ArcaSdkError).kind).toBe('soap_fault')
      expect((err as ArcaSdkError).faultCode).toBe('ns1:cms.cert.untrusted')
      expect(wsfeCalls('FECompUltimoAutorizado')).toHaveLength(0)
    })

    it('coe.alreadyAuthenticated sin store durable: el SDK lo vuelve error de configuracion, no un fault', async () => {
      sim.state.wsaaMode = 'already_authenticated'
      const err = await client()
        .getLastAuthorized({ cuit: CUIT_FALSO, pointOfSale: 1, voucherType: 11 })
        .catch((e: unknown) => e)
      expect((err as ArcaSdkError).kind).toBe('configuration')
      expect((err as ArcaSdkError).faultCode).toBeUndefined()
    })

    it('caracterizacion: tras un fault de WSAA el SDK no frena y vuelve a pedir loginCms en cada llamada', async () => {
      // La Especificacion Tecnica WSAA 1.2.2 (PDF p.8) pide no solicitar nuevos TA ante errores distintos de
      // wsaa.* / wsn.unavailable hasta resolver el problema. El SDK no lo implementa: si este test falla porque
      // el SDK agrego un freno, mejor; el adaptador deberia entonces dejar de agregar el suyo.
      sim.state.wsaaMode = 'untrusted'
      const c = client()
      await c.getLastAuthorized({ cuit: CUIT_FALSO, pointOfSale: 1, voucherType: 11 }).catch(() => {})
      await c.getLastAuthorized({ cuit: CUIT_FALSO, pointOfSale: 1, voucherType: 11 }).catch(() => {})
      expect(sim.state.requests.filter((r) => r.operation === 'loginCms')).toHaveLength(2)
    })

    it('wsaa.unavailable llega como soap_fault con su faultCode', async () => {
      sim.state.wsaaMode = 'unavailable'
      const err = await client()
        .getLastAuthorized({ cuit: CUIT_FALSO, pointOfSale: 1, voucherType: 11 })
        .catch((e: unknown) => e)
      expect((err as ArcaSdkError).faultCode).toBe('ns1:wsaa.unavailable')
    })

    it('un rechazo de WSAA al pedir CAE da INDETERMINATE (no lanza) y no llega a WSFE', async () => {
      sim.state.wsaaMode = 'untrusted'
      const r = await client().requestCae(baseRequest())
      expect(r.outcome).toBe('INDETERMINATE')
      expect(r.cae).toBeUndefined()
      expect(r.simulated).toBe(false)
      expect(r.errors[0]?.message).toContain('soap_fault')
      expect(wsfeCalls('FECAESolicitar')).toHaveLength(0)
    })
  })

  describe('getLastAuthorized', () => {
    it('devuelve el ultimo numero (el SDK devuelve el proximo y el adaptador resta 1)', async () => {
      sim.state.lastNumber = 41
      expect(await client().getLastAuthorized({ cuit: CUIT_FALSO, pointOfSale: 1, voucherType: 11 })).toEqual({ voucherNumber: 41 })
      const body = wsfeCalls('FECompUltimoAutorizado')[0]?.body ?? ''
      expect(body).toContain('<PtoVta>1</PtoVta>')
      expect(body).toContain('<CbteTipo>11</CbteTipo>')
    })

    it('sin comprobantes previos devuelve 0', async () => {
      sim.state.lastNumber = 0
      expect(await client().getLastAuthorized({ cuit: CUIT_FALSO, pointOfSale: 1, voucherType: 11 })).toEqual({ voucherNumber: 0 })
    })

    it('rechaza un CUIT distinto del configurado sin llamar a la red', async () => {
      await expect(client().getLastAuthorized({ cuit: '20000000002', pointOfSale: 1, voucherType: 11 })).rejects.toBeInstanceOf(ArcaSdkInputError)
      expect(sim.state.requests).toHaveLength(0)
    })
  })

  describe('requestCae: mapeo de resultados', () => {
    it('A sin observaciones -> AUTHORIZED con CAE y vencimiento', async () => {
      const r = await client().requestCae(baseRequest())
      expect(r).toMatchObject({ outcome: 'AUTHORIZED', cae: '70000000000001', caeExpiration: '20261029', observations: [], errors: [], simulated: false })
    })

    it('A con observaciones -> AUTHORIZED_WITH_OBSERVATIONS conservando el CAE', async () => {
      sim.state.caeScenario = 'authorized_with_obs'
      const r = await client().requestCae(baseRequest())
      expect(r.outcome).toBe('AUTHORIZED_WITH_OBSERVATIONS')
      expect(r.cae).toBe('70000000000001')
      expect(r.observations).toEqual([{ code: 10030, message: 'observacion de prueba' }])
    })

    it('R en el detalle -> REJECTED sin CAE; las Obs pasan a errors', async () => {
      sim.state.caeScenario = 'rejected_detail'
      const r = await client().requestCae(baseRequest())
      expect(r.outcome).toBe('REJECTED')
      expect(r.cae).toBeUndefined()
      expect(r.errors.map((e) => e.code)).toEqual([10016, 10030])
      expect(r.observations).toEqual([])
    })

    it('R de cabecera con Errors de negocio -> REJECTED', async () => {
      sim.state.caeScenario = 'rejected_header_errors'
      const r = await client().requestCae(baseRequest())
      expect(r.outcome).toBe('REJECTED')
      expect(r.errors).toEqual([{ code: 10002, message: 'error de prueba a nivel request' }])
    })

    it('error 600 de WSFE (token/firma) -> INDETERMINATE, nunca REJECTED', async () => {
      sim.state.caeScenario = 'auth_error_600'
      const r = await client().requestCae(baseRequest())
      expect(r.outcome).toBe('INDETERMINATE')
      expect(r.errors.some((e) => e.code === 600)).toBe(true)
    })

    it('error 500 de WSFE (interno) -> INDETERMINATE', async () => {
      sim.state.caeScenario = 'infra_error_500'
      const r = await client().requestCae(baseRequest())
      expect(r.outcome).toBe('INDETERMINATE')
      expect(r.errors.some((e) => e.code === 500)).toBe(true)
    })

    it('respuesta contradictoria (cabecera A, detalle R con CAE) -> INDETERMINATE y NO informa CAE', async () => {
      sim.state.caeScenario = 'contradictory'
      const r = await client().requestCae(baseRequest())
      expect(r.outcome).toBe('INDETERMINATE')
      expect(r.cae).toBeUndefined()
    })

    it('aprobado sin CAE -> INDETERMINATE', async () => {
      sim.state.caeScenario = 'no_cae_approved'
      const r = await client().requestCae(baseRequest())
      expect(r.outcome).toBe('INDETERMINATE')
      expect(r.cae).toBeUndefined()
    })

    it.each(['http_500_html', 'soap_fault', 'garbage'] as const)('falla de transporte/protocolo (%s) -> INDETERMINATE, sin reintento', async (scenario) => {
      sim.state.caeScenario = scenario
      const r = await client().requestCae(baseRequest())
      expect(r.outcome).toBe('INDETERMINATE')
      expect(wsfeCalls('FECAESolicitar')).toHaveLength(1)
    })

    it('timeout sin respuesta -> INDETERMINATE, una sola solicitud enviada', async () => {
      sim.state.caeScenario = 'hang'
      const r = await client(300).requestCae(baseRequest())
      expect(r.outcome).toBe('INDETERMINATE')
      expect(wsfeCalls('FECAESolicitar')).toHaveLength(1)
    })
  })

  describe('requestCae: lo que se envia a WSFE', () => {
    it('arma FECAEDetRequest con los campos del CaeRequest y usa SOAP 1.2', async () => {
      await client().requestCae(baseRequest({ docNumber: '20000000002', netAmount: '826.45', ivaAmount: '0.00', totalAmount: '826.45' }))
      const call = wsfeCalls('FECAESolicitar')[0]
      expect(call?.contentType).toContain('application/soap+xml')
      const b = call?.body ?? ''
      for (const frag of [
        '<CantReg>1</CantReg>', '<PtoVta>1</PtoVta>', '<CbteTipo>11</CbteTipo>', '<Concepto>1</Concepto>',
        '<DocTipo>80</DocTipo>', '<DocNro>20000000002</DocNro>', '<CbteDesde>42</CbteDesde>', '<CbteHasta>42</CbteHasta>',
        '<CbteFch>20261019</CbteFch>', '<ImpTotal>826.45</ImpTotal>', '<ImpNeto>826.45</ImpNeto>', '<ImpIVA>0.00</ImpIVA>',
        '<MonId>PES</MonId>', '<CondicionIVAReceptorId>5</CondicionIVAReceptorId>',
      ]) {
        expect(b, frag).toContain(frag)
      }
    })

    it('no manda la clave de idempotencia a ARCA', async () => {
      await client().requestCae(baseRequest({ idempotencyKey: 'clave-secreta-xyz' }))
      expect(wsfeCalls('FECAESolicitar')[0]?.body).not.toContain('clave-secreta-xyz')
    })

    it.each(['0.01', '0.07', '1.15', '19.99', '100.10', '1000.00', '123456.78', '999999999999.99', '1234567890123.45'])(
      'importe %s se serializa tal cual (sin error de punto flotante)',
      async (amount) => {
        await client().requestCae(baseRequest({ netAmount: amount, ivaAmount: '0.00', totalAmount: amount }))
        const b = wsfeCalls('FECAESolicitar')[0]?.body ?? ''
        expect(b).toContain(`<ImpTotal>${amount}</ImpTotal>`)
        expect(b).toContain(`<ImpNeto>${amount}</ImpNeto>`)
      },
    )
  })

  describe('requestCae: validacion local (no se envia nada)', () => {
    it.each([
      ['importe con coma', { totalAmount: '1000,00' }],
      ['importe con 3 decimales', { totalAmount: '10.123' }],
      ['importe negativo', { totalAmount: '-1.00' }],
      ['notacion cientifica', { totalAmount: '1e3' }],
      ['fecha mal formada', { voucherDate: '2026-10-19' }],
      ['moneda en minusculas', { currency: 'pes' }],
      ['docNumber no numerico', { docNumber: '20-0000000-2' }],
      ['CUIT de otro emisor', { cuit: '20000000002' }],
      ['numero de comprobante 0', { voucherNumber: 0 }],
    ] as Array<[string, Partial<CaeRequest>]>)('%s -> ArcaSdkInputError', async (_n, over) => {
      await expect(client().requestCae(baseRequest(over))).rejects.toBeInstanceOf(ArcaSdkInputError)
      expect(sim.state.requests).toHaveLength(0)
    })

    it('total distinto de neto + IVA lo frena el SDK antes de enviar', async () => {
      const err = await client()
        .requestCae(baseRequest({ netAmount: '1000.00', ivaAmount: '0.00', totalAmount: '1500.00' }))
        .catch((e: unknown) => e)
      expect(err).toBeInstanceOf(ArcaSdkInputError)
      expect(sim.state.requests).toHaveLength(0)
    })
  })
})

describe('importes', () => {
  it('decimalStringToCents acepta los formatos validos', () => {
    expect(decimalStringToCents('0', 'x')).toBe(0n)
    expect(decimalStringToCents('0.5', 'x')).toBe(50n)
    expect(decimalStringToCents('1000.00', 'x')).toBe(100000n)
    expect(decimalStringToCents('1234567890123.45', 'x')).toBe(123456789012345n)
  })

  it.each(['', '-1', '1,5', '01.00', '1.', '.5', '1e2', '12345678901234.00', '1.234', ' 1.00'])('rechaza %j', (v) => {
    expect(() => decimalStringToCents(v, 'x')).toThrow(ArcaSdkInputError)
  })

  it('centsToSdkNumber ida y vuelta para 20000 importes pseudoaleatorios', () => {
    let seed = 12345
    for (let i = 0; i < 20000; i++) {
      seed = (seed * 1103515245 + 12345) % 2147483648
      const cents = BigInt(seed) * BigInt(1 + (i % 50))
      const text = `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`
      expect(decimalStringToCents(text, 'x')).toBe(cents)
      expect(Math.round(centsToSdkNumber(cents) * 100)).toBe(Number(cents))
    }
  })
})

// Opcional: repite contra el entorno REAL de homologacion lo que no necesita certificado valido.
// Sale a internet; no se corre por defecto. ARCA_REAL_TESTS=1 pnpm test -- arca-sdk-client
describe.runIf(process.env.ARCA_REAL_TESTS === '1' && hasOpenssl())('ArcaSdkClient contra HOMOLOGACION REAL (sin certificado valido)', () => {
  it('FEDummy responde OK sin autenticacion', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'arca-sdk-real-'))
    try {
      execFileSync(
        'openssl',
        ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', join(dir, 'k.pem'), '-out', join(dir, 'c.pem'), '-days', '2', '-subj', `/C=AR/O=Prueba/CN=autofirmado/serialNumber=CUIT ${CUIT_FALSO}`],
        { stdio: 'ignore' },
      )
      const c = new ArcaSdkClient({
        cuit: CUIT_FALSO,
        certificatePem: readFileSync(join(dir, 'c.pem'), 'utf8'),
        privateKeyPem: readFileSync(join(dir, 'k.pem'), 'utf8'),
        timeoutMs: 30000,
      })
      expect((await c.healthCheck()).ok).toBe(true)
      const err = await c.getLastAuthorized({ cuit: CUIT_FALSO, pointOfSale: 1, voucherType: 11 }).catch((e: unknown) => e)
      expect((err as ArcaSdkError).faultCode).toBe('ns1:cms.cert.untrusted')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  }, 60000)
})
