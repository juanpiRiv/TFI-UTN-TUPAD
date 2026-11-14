/**
 * Chequeo de SOLO LECTURA contra el WSAA y el WSFEv1 de HOMOLOGACIÓN de ARCA.
 * No emite ningún comprobante. Sirve para comprobar, antes de facturar, que:
 *   1. el certificado y la clave autentican en el WSAA (se pide el ticket de acceso),
 *   2. el punto de venta existe y se puede usar,
 *   3. los códigos de condición de IVA del receptor son los que usa el código.
 *
 * Uso (desde backend/, con las variables ARCA_* cargadas en backend/.env):
 *   pnpm arca:smoke [1,2]        (puntos de venta separados por coma; por defecto 1,2)
 *
 * No imprime certificados, claves, tokens ni firmas.
 */
import { createArcaClient } from 'facturas'
import { loadArcaCredentialsFromEnv } from '../src/module/arca/credentials-from-env.js'
import { defaultSessionDir } from '../src/module/arca/provider-from-env.js'
import { FileWsaaSessionStore } from '../src/module/arca/sdk/wsaa-session-store.js'

const FACTURA_C = 11

function describeError(error: unknown): string {
  if (error instanceof Error) {
    const faultCode = (error as { faultCode?: string }).faultCode
    return `${error.name}${faultCode ? ` (${faultCode})` : ''}: ${error.message}`
  }
  return String(error)
}

async function step<T>(label: string, run: () => Promise<T>): Promise<T | undefined> {
  try {
    const result = await run()
    console.log(`OK    ${label}`)
    return result
  } catch (error) {
    console.log(`ERROR ${label}\n      ${describeError(error)}`)
    return undefined
  }
}

async function main() {
  if (process.env.ARCA_MODE === 'produccion') {
    console.error('Este chequeo solo corre contra homologación. ARCA_MODE=produccion no está permitido acá.')
    process.exit(1)
  }

  const credentials = loadArcaCredentialsFromEnv(process.env)
  const salesPoints = (process.argv[2] ?? process.env.ARCA_SMOKE_POINT_OF_SALE ?? '1,2')
    .split(',')
    .map((value) => Number(value.trim()))
  if (salesPoints.length === 0 || salesPoints.some((value) => !Number.isInteger(value) || value < 1)) {
    console.error('Los puntos de venta tienen que ser enteros positivos separados por coma, por ejemplo 1,2.')
    process.exit(1)
  }

  const client = createArcaClient({
    taxId: credentials.cuit,
    certificatePem: credentials.certificatePem,
    privateKeyPem: credentials.privateKeyPem,
    environment: 'test',
    // Mismo almacén que el backend: así los dos comparten el ticket y ARCA no responde coe.alreadyAuthenticated.
    wsaaSessionStore: new FileWsaaSessionStore(defaultSessionDir(process.env)),
    logger: { log: () => {} },
  })

  console.log(`Ambiente: homologación (wswhomo). CUIT terminado en ...${credentials.cuit.slice(-4)}. Puntos de venta a probar: ${salesPoints.join(', ')}.\n`)

  const status = await step('FEDummy (estado del servicio, sin autenticación)', () => client.wsfe.getServerStatus())
  if (status) console.log(`      ${JSON.stringify(status)}`)

  // Primer uso autenticado: acá el SDK arma el TRA, lo firma y llama al WSAA. Se prueba cada punto de venta por separado.
  const nextNumbers: Array<number | undefined> = []
  for (const salesPoint of salesPoints) {
    const next = await step(`WSAA + FECompUltimoAutorizado, punto de venta ${salesPoint}`, () =>
      client.wsfe.getNextVoucherNumber({ salesPoint, voucherType: FACTURA_C }),
    )
    nextNumbers.push(next)
    if (next !== undefined) console.log(`      Próximo número de Factura C en el punto de venta ${salesPoint}: ${next}`)
  }

  const points = await step('FEParamGetPtosVenta (lista de puntos de venta que informa ARCA)', () => client.wsfe.getSalesPoints())
  if (points) {
    for (const point of points) console.log(`      ${JSON.stringify(point)}`)
    if (points.length === 0) {
      console.log('      ARCA no lista ninguno. En homologación puede pasar aunque el número exista: lo que vale es que FECompUltimoAutorizado no dé error.')
    }
  }

  const conditions = await step('FEParamGetCondicionIvaReceptor (clase C)', () =>
    client.wsfe.getReceiverVatConditions({ voucherClass: 'C' }),
  )
  if (conditions) for (const condition of conditions) console.log(`      ${JSON.stringify(condition)}`)

  const failed = [status, points, conditions, ...nextNumbers].some((value) => value === undefined)
  console.log(failed ? '\nHubo errores: ver arriba.' : '\nTodo respondió. Se puede intentar una emisión de prueba.')
  process.exit(failed ? 2 : 0)
}

main().catch((error) => {
  console.error(describeError(error))
  process.exit(1)
})
