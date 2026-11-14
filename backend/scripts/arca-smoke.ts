/**
 * Chequeo de SOLO LECTURA contra el WSAA y el WSFEv1 de HOMOLOGACIÓN de ARCA.
 * No emite ningún comprobante. Sirve para comprobar, antes de facturar, que:
 *   1. el certificado y la clave autentican en el WSAA (se pide el ticket de acceso),
 *   2. el punto de venta existe y se puede usar,
 *   3. los códigos de condición de IVA del receptor son los que usa el código.
 *
 * Uso (desde backend/, con las variables ARCA_* cargadas en backend/.env):
 *   pnpm arca:smoke [puntoDeVenta]
 *
 * No imprime certificados, claves, tokens ni firmas.
 */
import { createArcaClient } from 'facturas'
import { loadArcaCredentialsFromEnv } from '../src/module/arca/credentials-from-env.js'

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
  const salesPoint = Number(process.argv[2] ?? process.env.ARCA_SMOKE_POINT_OF_SALE ?? '1')
  if (!Number.isInteger(salesPoint) || salesPoint < 1) {
    console.error('El punto de venta tiene que ser un entero positivo.')
    process.exit(1)
  }

  const client = createArcaClient({
    taxId: credentials.cuit,
    certificatePem: credentials.certificatePem,
    privateKeyPem: credentials.privateKeyPem,
    environment: 'test',
    logger: { log: () => {} },
  })

  console.log(`Ambiente: homologación (wswhomo). CUIT terminado en ...${credentials.cuit.slice(-4)}. Punto de venta consultado: ${salesPoint}.\n`)

  const status = await step('FEDummy (estado del servicio, sin autenticación)', () => client.wsfe.getServerStatus())
  if (status) console.log(`      ${JSON.stringify(status)}`)

  // Primer uso autenticado: acá el SDK arma el TRA, lo firma y llama al WSAA.
  const next = await step('WSAA + FECompUltimoAutorizado (primer ticket de acceso real)', () =>
    client.wsfe.getNextVoucherNumber({ salesPoint, voucherType: FACTURA_C }),
  )
  if (next !== undefined) console.log(`      Próximo número de Factura C en el punto de venta ${salesPoint}: ${next}`)

  const points = await step('FEParamGetPtosVenta (puntos de venta del contribuyente)', () => client.wsfe.getSalesPoints())
  if (points) {
    for (const point of points) console.log(`      ${JSON.stringify(point)}`)
    if (points.length === 0) console.log('      No hay ningún punto de venta habilitado para web service: hay que darlo de alta en ARCA.')
  }

  const conditions = await step('FEParamGetCondicionIvaReceptor (clase C)', () =>
    client.wsfe.getReceiverVatConditions({ voucherClass: 'C' }),
  )
  if (conditions) for (const condition of conditions) console.log(`      ${JSON.stringify(condition)}`)

  const failed = [status, next, points, conditions].some((value) => value === undefined)
  console.log(failed ? '\nHubo errores: ver arriba.' : '\nTodo respondió. Se puede intentar una emisión de prueba.')
  process.exit(failed ? 2 : 0)
}

main().catch((error) => {
  console.error(describeError(error))
  process.exit(1)
})
