/**
 * Recorrido de punta a punta contra un backend LOCAL: usuario, organización con el CUIT de
 * ARCA_CUIT, punto de venta, borrador de Factura C y "Facturar". Con ARCA_PROVIDER=sdk y
 * ARCA_MODE=homologacion el pedido llega al WSFEv1 de homologación de ARCA.
 *
 * Antes hay que levantar el backend (pnpm dev) y haber corrido `pnpm arca:smoke` sin errores.
 *
 * Uso (desde backend/):
 *   pnpm arca:e2e [1,2]      (puntos de venta separados por coma; por defecto 1,2)
 *   E2E_SCENARIOS=basic,services,receiver pnpm arca:e2e 1,2
 *
 * Escenarios (por defecto solo `basic`):
 *   basic     Factura C por productos a consumidor final.
 *   services  Factura C por servicios, con período del servicio y vencimiento del pago.
 *   receiver  Factura C a receptores identificados: CUIT de Responsable Inscripto, CUIT de Monotributo,
 *             DNI de consumidor final y servicios a un CUIT de Responsable Inscripto.
 *
 * Emite UNA factura de prueba por escenario y punto de venta, en homologación, sin validez fiscal.
 * Después de autorizar, cada factura se verifica contra ARCA con FECompConsultar (mismo ticket compartido).
 * Imprime solo escenario, punto de venta, número, CAE y resultado: nunca tokens ni credenciales.
 */
import { createArcaClient } from 'facturas'
import { loadArcaCredentialsFromEnv } from '../src/module/arca/credentials-from-env.js'
import { createWsaaSessionStore } from '../src/module/arca/wsaa-store-factory.js'
import { prisma } from '../src/lib/prisma.js'
import { buildScenarios, type Scenario } from './arca-e2e-scenarios.js'

const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const AMOUNT = 1500

type PointOfSaleRow = { id: number; number: number }

function fail(message: string): never {
  console.error(message)
  process.exit(1)
}

async function call<T = Record<string, unknown>>(
  method: 'GET' | 'POST',
  path: string,
  token?: string,
  body?: unknown,
): Promise<{ status: number; body: T }> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const text = await response.text()
  return { status: response.status, body: (text ? JSON.parse(text) : {}) as T }
}

function expectStatus(label: string, actual: number, expected: number[], body: unknown): void {
  if (expected.includes(actual)) {
    console.log(`OK    ${label} (HTTP ${actual})`)
    return
  }
  fail(`ERROR ${label}: HTTP ${actual}\n      ${JSON.stringify(body)}`)
}

/** Devuelve el id del punto de venta con ese número: lo crea o, si la organización ya lo tiene, lo reutiliza. */
async function ensurePointOfSale(token: string, number: number): Promise<number> {
  const created = await call<PointOfSaleRow>('POST', '/api/points-of-sale', token, { number })
  if (created.status !== 409) {
    expectStatus(`Punto de venta ${number} creado`, created.status, [201], created.body)
    return created.body.id
  }
  const list = await call<PointOfSaleRow[] | { items?: PointOfSaleRow[] }>('GET', '/api/points-of-sale', token)
  const rows = Array.isArray(list.body) ? list.body : (list.body.items ?? [])
  const existing = rows.find((row) => row.number === number)
  if (!existing) fail(`ERROR Punto de venta ${number}: ya existe pero no se pudo listar (HTTP ${list.status})`)
  console.log(`OK    Punto de venta ${number} ya existía en la organización: se reutiliza`)
  return existing.id
}

type ClientRow = { id: number; docType?: string | null; docNumber?: string | null }

/** Devuelve el id del cliente con ese documento: lo crea o, si ya existe en la organización, lo reutiliza. */
async function ensureClient(token: string, receiver: NonNullable<Scenario['receiver']>): Promise<number> {
  const created = await call<ClientRow>('POST', '/api/clients', token, {
    name: receiver.name,
    docType: receiver.docType,
    docNumber: receiver.docNumber,
    taxCondition: receiver.taxCondition,
  })
  if (created.status !== 409) {
    expectStatus(`Cliente ${receiver.docType} (${receiver.taxCondition}) creado`, created.status, [201], created.body)
    return created.body.id
  }
  const list = await call<ClientRow[] | { items?: ClientRow[] }>('GET', '/api/clients', token)
  const rows = Array.isArray(list.body) ? list.body : (list.body.items ?? [])
  const existing = rows.find((row) => row.docType === receiver.docType && row.docNumber === receiver.docNumber)
  if (!existing) fail(`ERROR Cliente ${receiver.docType}: ya existe pero no se pudo listar (HTTP ${list.status})`)
  return existing.id
}

type Lookup = { kind: string; voucher?: { result?: string; cae?: string; concept?: number; documentType?: number; documentNumber?: string; receiverVatConditionId?: number; serviceStartDate?: string; serviceEndDate?: string; paymentDueDate?: string } }

/** Consulta el comprobante en ARCA (FECompConsultar) con el mismo ticket que usa el backend. */
async function lookupInArca(pointOfSale: number, voucherNumber: number): Promise<Lookup> {
  const credentials = loadArcaCredentialsFromEnv(process.env)
  const client = createArcaClient({
    taxId: credentials.cuit,
    certificatePem: credentials.certificatePem,
    privateKeyPem: credentials.privateKeyPem,
    environment: 'test',
    // Mismo almacén que el backend (base de datos con ARCA_ENCRYPTION_KEY, archivo sin ella): comparten el ticket.
    wsaaSessionStore: createWsaaSessionStore(process.env, prisma),
    logger: { log: () => {} },
  })
  return (await client.wsfe.lookupVoucher({ number: voucherNumber, salesPoint: pointOfSale, voucherType: 11 })) as Lookup
}

/** Crea un borrador de Factura C según el escenario, la factura y la verifica contra ARCA. */
async function issueOne(token: string, scenario: Scenario, number: number): Promise<boolean> {
  console.log(`\n=== Escenario ${scenario.name} / punto de venta ${number} ===`)
  const pointOfSaleId = await ensurePointOfSale(token, number)
  const clientId = scenario.receiver ? await ensureClient(token, scenario.receiver) : undefined

  const draft = await call<{ invoiceId: number }>('POST', '/api/invoices', token, {
    pointOfSaleId,
    ...(clientId === undefined ? {} : { clientId }),
    concept: scenario.concept,
    issueDate: new Date().toISOString().slice(0, 10),
    ...(scenario.serviceDates ?? {}),
    items: [{ description: scenario.description, quantity: 1, unitPrice: AMOUNT }],
  })
  expectStatus(`Borrador de Factura C por $ ${AMOUNT}`, draft.status, [201], draft.body)

  const result = await call<{ invoice?: Record<string, unknown>; fiscal?: Record<string, unknown>; error?: string }>(
    'POST',
    `/api/invoices/${draft.body.invoiceId}/authorize`,
    token,
  )
  const fiscal = result.body.fiscal ?? {}
  const invoice = result.body.invoice ?? {}
  console.log(`Facturar: HTTP ${result.status}`)
  console.log(
    JSON.stringify(
      {
        escenario: scenario.name,
        puntoDeVenta: number,
        estadoFactura: invoice.status,
        numeroDeComprobante: invoice.voucherNumber,
        cae: invoice.cae,
        vencimientoCae: invoice.caeExpiration,
        resultado: fiscal.outcome,
        simulado: fiscal.simulated,
        observaciones: fiscal.observations,
        errores: fiscal.errors,
        error: result.body.error,
      },
      null,
      2,
    ),
  )

  const authorized = result.status === 200 && fiscal.outcome === 'AUTHORIZED'
  if (!authorized) {
    console.log(`Escenario ${scenario.name}, punto de venta ${number}: NO autorizada.`)
    return false
  }
  if (fiscal.simulated) {
    console.log(`Escenario ${scenario.name}, punto de venta ${number}: autorizada por el proveedor SIMULADO (no llegó a ARCA).`)
    return false
  }

  // Verificación independiente: ARCA tiene que devolver el mismo CAE, Resultado A y los datos del receptor.
  const found = await lookupInArca(number, Number(invoice.voucherNumber))
  const v = found.voucher
  const problems: string[] = []
  if (found.kind !== 'found' || !v) problems.push('FECompConsultar no encontró el comprobante')
  else {
    if (v.result !== 'A') problems.push(`Resultado ${v.result} (se esperaba A)`)
    if (v.cae !== invoice.cae) problems.push('CodAutorizacion distinto del CAE guardado')
    const expected = scenario.expectedInArca
    if (v.concept !== expected.concept) problems.push(`Concepto ${v.concept} (se esperaba ${expected.concept})`)
    if (v.documentType !== expected.documentType) problems.push(`DocTipo ${v.documentType} (se esperaba ${expected.documentType})`)
    if (v.receiverVatConditionId !== expected.receiverVatConditionId) {
      problems.push(`CondicionIVAReceptorId ${v.receiverVatConditionId} (se esperaba ${expected.receiverVatConditionId})`)
    }
    if (expected.hasServiceDates && !(v.serviceStartDate && v.serviceEndDate && v.paymentDueDate)) {
      problems.push('faltan las fechas de servicio en el comprobante de ARCA')
    }
  }
  console.log(
    `VERIFICADO ${JSON.stringify({
      escenario: scenario.name,
      puntoDeVenta: number,
      numero: invoice.voucherNumber,
      cae: v?.cae,
      resultadoArca: v?.result,
      docTipo: v?.documentType,
      condicionIvaReceptor: v?.receiverVatConditionId,
      concepto: v?.concept,
      fechasServicio: v?.serviceStartDate ? [v.serviceStartDate, v.serviceEndDate, v.paymentDueDate] : undefined,
      problemas: problems,
    })}`,
  )
  return problems.length === 0
}

async function main() {
  const url = new URL(BASE_URL)
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) {
    fail('Este recorrido solo corre contra un backend local (localhost).')
  }
  if (process.env.ARCA_MODE === 'produccion') fail('ARCA_MODE=produccion no está permitido en este recorrido.')

  const cuit = process.env.ARCA_CUIT?.trim()
  if (!cuit || !/^\d{11}$/.test(cuit)) fail('Falta ARCA_CUIT (11 dígitos): tiene que ser el CUIT del certificado.')

  const pointsOfSale = (process.argv[2] ?? process.env.ARCA_SMOKE_POINT_OF_SALE ?? '1,2')
    .split(',')
    .map((value) => Number(value.trim()))
  if (pointsOfSale.some((value) => !Number.isInteger(value) || value < 1)) {
    fail('Indicá los puntos de venta habilitados, separados por coma: pnpm arca:e2e 1,2')
  }

  const health = await call('GET', '/health')
  expectStatus('Backend local responde', health.status, [200], health.body)

  // Usuario fijo de prueba: así el recorrido se puede repetir sin chocar con el CUIT, que es único.
  const email = 'arca-e2e@test.local'
  const password = process.env.E2E_PASSWORD ?? 'E2e-Arca-Test-1!'
  let token: string
  const register = await call<{ token: string }>('POST', '/api/auth/register', undefined, { email, password })
  if (register.status === 409) {
    const login = await call<{ token: string }>('POST', '/api/auth/login', undefined, { email, password })
    expectStatus('Usuario de prueba ya existía: inicio de sesión', login.status, [200], login.body)
    token = login.body.token
  } else {
    expectStatus('Usuario de prueba creado', register.status, [201], register.body)
    token = register.body.token
  }

  const mine = await call<{ id?: number }>('GET', '/api/organizations/me', token)
  if (mine.status === 200 && mine.body.id) {
    console.log('OK    La organización de prueba ya existía: se reutiliza')
  } else {
    const org = await call<{ id: number }>('POST', '/api/organizations', token, {
      cuit,
      legalName: 'Prueba E2E ARCA',
      taxCondition: 'MONOTRIBUTO',
      baseCurrency: 'ARS',
    })
    expectStatus('Organización creada con el CUIT de ARCA_CUIT', org.status, [201], org.body)
  }

  // Con E2E_UPLOAD_CREDENTIAL=true se prueba el camino de un cliente: cargar el certificado y la clave por la API.
  if (process.env.E2E_UPLOAD_CREDENTIAL === 'true') {
    const { readFileSync } = await import('node:fs')
    const certPath = process.env.ARCA_CERT_PATH
    const keyPath = process.env.ARCA_KEY_PATH
    if (!certPath || !keyPath) fail('Con E2E_UPLOAD_CREDENTIAL=true hacen falta ARCA_CERT_PATH y ARCA_KEY_PATH.')
    const saved = await call<{ configured?: boolean; environment?: string; certificateExpiresAt?: string }>(
      'POST',
      '/api/organizations/me/arca-credential',
      token,
      { certificate: readFileSync(certPath, 'utf8'), privateKey: readFileSync(keyPath, 'utf8') },
    )
    expectStatus('Credencial de ARCA cargada por la API', saved.status, [200], saved.body)
    console.log(`      configurada: ${saved.body.configured}, ambiente: ${saved.body.environment}, vence: ${saved.body.certificateExpiresAt}`)
  }

  const requested = (process.env.E2E_SCENARIOS ?? 'basic').split(',').map((value) => value.trim()).filter(Boolean)
  const scenarios = buildScenarios(requested, new Date())
  if (scenarios.length === 0) fail('E2E_SCENARIOS no incluye ningún escenario válido (basic, services, receiver).')

  let allOk = true
  for (const scenario of scenarios) {
    for (const number of pointsOfSale) {
      const ok = await issueOne(token, scenario, number)
      allOk = allOk && ok
    }
  }
  await prisma.$disconnect()
  process.exit(allOk ? 0 : 2)
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
