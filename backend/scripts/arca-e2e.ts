/**
 * Recorrido de punta a punta contra un backend LOCAL: usuario, organización con el CUIT de
 * ARCA_CUIT, punto de venta, borrador de Factura C y "Facturar". Con ARCA_PROVIDER=sdk y
 * ARCA_MODE=homologacion el pedido llega al WSFEv1 de homologación de ARCA.
 *
 * Antes hay que levantar el backend (pnpm dev) y haber corrido `pnpm arca:smoke` sin errores.
 *
 * Uso (desde backend/):
 *   pnpm arca:e2e [1,2]      (puntos de venta separados por coma; por defecto 1,2)
 *
 * Emite UNA factura de prueba por cada punto de venta indicado, en homologación, sin validez fiscal.
 * Imprime solo el resultado (estado, CAE, observaciones): nunca tokens ni credenciales.
 */
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

/** Crea un borrador de Factura C, la factura y devuelve si ARCA (o el simulador) la autorizó. */
async function issueOne(token: string, number: number): Promise<boolean> {
  console.log(`\n=== Punto de venta ${number} ===`)
  const pointOfSaleId = await ensurePointOfSale(token, number)

  const draft = await call<{ invoiceId: number }>('POST', '/api/invoices', token, {
    pointOfSaleId,
    concept: 'PRODUCTOS',
    issueDate: new Date().toISOString().slice(0, 10),
    items: [{ description: 'Prueba de homologación', quantity: 1, unitPrice: AMOUNT }],
  })
  expectStatus(`Borrador de Factura C por $ ${AMOUNT}`, draft.status, [201], draft.body)

  const result = await call<{ invoice?: Record<string, unknown>; fiscal?: Record<string, unknown>; error?: string }>(
    'POST',
    `/api/invoices/${draft.body.invoiceId}/authorize`,
    token,
  )
  const fiscal = result.body.fiscal ?? {}
  const invoice = result.body.invoice ?? {}
  console.log(`\nFacturar: HTTP ${result.status}`)
  console.log(
    JSON.stringify(
      {
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

  const ok = result.status === 200 && fiscal.outcome === 'AUTHORIZED'
  if (!ok) console.log(`\nPunto de venta ${number}: NO autorizada.`)
  else if (fiscal.simulated) console.log(`\nPunto de venta ${number}: autorizada por el proveedor SIMULADO (no llegó a ARCA).`)
  else console.log(`\nPunto de venta ${number}: autorizada por ARCA en homologación.`)
  return ok
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

  let allOk = true
  for (const number of pointsOfSale) {
    const ok = await issueOne(token, number)
    allOk = allOk && ok
  }
  process.exit(allOk ? 0 : 2)
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
