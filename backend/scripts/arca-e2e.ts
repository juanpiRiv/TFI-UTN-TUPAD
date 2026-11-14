/**
 * Recorrido de punta a punta contra un backend LOCAL: usuario, organización con el CUIT de
 * ARCA_CUIT, punto de venta, borrador de Factura C y "Facturar". Con ARCA_PROVIDER=sdk y
 * ARCA_MODE=homologacion el pedido llega al WSFEv1 de homologación de ARCA.
 *
 * Antes hay que levantar el backend (pnpm dev) y haber corrido `pnpm arca:smoke` sin errores.
 *
 * Uso (desde backend/):
 *   pnpm arca:e2e <numeroDePuntoDeVenta>
 *
 * Emite UNA factura de prueba por ejecución, en homologación, sin validez fiscal.
 * Imprime solo el resultado (estado, CAE, observaciones): nunca tokens ni credenciales.
 */
const BASE_URL = process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const AMOUNT = 1500

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

async function main() {
  const url = new URL(BASE_URL)
  if (!['localhost', '127.0.0.1', '::1', '[::1]'].includes(url.hostname)) {
    fail('Este recorrido solo corre contra un backend local (localhost).')
  }
  if (process.env.ARCA_MODE === 'produccion') fail('ARCA_MODE=produccion no está permitido en este recorrido.')

  const cuit = process.env.ARCA_CUIT?.trim()
  if (!cuit || !/^\d{11}$/.test(cuit)) fail('Falta ARCA_CUIT (11 dígitos): tiene que ser el CUIT del certificado.')

  const pointOfSale = Number(process.argv[2] ?? process.env.ARCA_SMOKE_POINT_OF_SALE)
  if (!Number.isInteger(pointOfSale) || pointOfSale < 1) {
    fail('Indicá el número de punto de venta habilitado para web service: pnpm arca:e2e <numero>')
  }

  const health = await call('GET', '/health')
  expectStatus('Backend local responde', health.status, [200], health.body)

  const stamp = Date.now()
  const password = `E2e-${stamp}-Aa1!`
  const register = await call<{ token: string }>('POST', '/api/auth/register', undefined, {
    email: `arca-e2e-${stamp}@test.local`,
    password,
  })
  expectStatus('Usuario de prueba creado', register.status, [201], register.body)
  const token = register.body.token

  const org = await call<{ id: number }>('POST', '/api/organizations', token, {
    cuit,
    legalName: 'Prueba E2E ARCA',
    taxCondition: 'MONOTRIBUTO',
    baseCurrency: 'ARS',
  })
  expectStatus('Organización creada con el CUIT de ARCA_CUIT', org.status, [201], org.body)

  const pos = await call<{ id: number }>('POST', '/api/points-of-sale', token, { number: pointOfSale })
  expectStatus(`Punto de venta ${pointOfSale} creado`, pos.status, [201], pos.body)

  const today = new Date().toISOString().slice(0, 10)
  const draft = await call<{ invoiceId: number }>('POST', '/api/invoices', token, {
    pointOfSaleId: pos.body.id,
    concept: 'PRODUCTOS',
    issueDate: today,
    items: [{ description: 'Prueba de homologación', quantity: 1, unitPrice: AMOUNT }],
  })
  expectStatus(`Borrador de Factura C por $ ${AMOUNT}`, draft.status, [201], draft.body)

  const result = await call<{ invoice?: Record<string, unknown>; fiscal?: Record<string, unknown>; error?: string }>(
    'POST',
    `/api/invoices/${draft.body.invoiceId}/authorize`,
    token,
  )
  console.log(`\nFacturar: HTTP ${result.status}`)
  const fiscal = result.body.fiscal ?? {}
  const invoice = result.body.invoice ?? {}
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

  if (result.status === 200 && fiscal.outcome === 'AUTHORIZED') {
    console.log(fiscal.simulated ? '\nAutorizada por el proveedor SIMULADO (no llegó a ARCA).' : '\nAutorizada por ARCA en homologación.')
    return
  }
  process.exit(2)
}

main().catch((error) => fail(error instanceof Error ? error.message : String(error)))
