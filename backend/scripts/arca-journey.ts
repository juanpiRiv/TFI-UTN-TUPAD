/**
 * Recorrido del CLIENTE de punta a punta, por HTTP real contra un backend LOCAL, con sus casos de error:
 * alta de usuario y organización, datos del emisor, credencial de ARCA por CSR (certificado firmado por una CA
 * descartable en memoria, como lo haría ARCA), aislamiento entre organizaciones y baja de la credencial.
 *
 * Imprime una línea PASS/FAIL por paso (sin secretos) y sale con código distinto de cero si algún paso falla.
 * Crea usuarios journey-<aleatorio>@test.local y los borra al terminar (por Prisma, solo con DATABASE_URL local).
 *
 * Uso (desde backend/, con el backend corriendo con ARCA_PROVIDER=sdk):  pnpm arca:journey
 * El paso 8 sale a la red hacia el WSAA de homologación (el certificado no es de confianza: ARCA lo rechaza).
 */
import { prisma } from '../src/lib/prisma.js'
import { validCuitFrom } from './arca-e2e-scenarios.js'
import { createThrowawayCa, leaks, randomCuit, readCsr } from './arca-journey-helpers.js'

const BASE_URL = process.env.JOURNEY_BASE_URL ?? process.env.E2E_BASE_URL ?? 'http://localhost:3000'
const LOCAL_HOSTS = ['localhost', '127.0.0.1', '::1', '[::1]']
const PASSWORD = 'Journey-Test-1!'

type Json = Record<string, any>
interface Res { status: number; body: Json; text: string }

async function call(method: string, path: string, token?: string, body?: unknown): Promise<Res> {
  const response = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(60_000),
  })
  const text = await response.text()
  let parsed: Json = {}
  try { parsed = text ? JSON.parse(text) : {} } catch { parsed = {} }
  return { status: response.status, body: parsed, text }
}

let failures = 0
let current = ''
function step(name: string) { current = name }
/** Registra una comprobación del paso actual. `detail` nunca debe llevar secretos. */
function check(ok: boolean, what: string, detail = '') {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'}  [${current}] ${what}${detail ? ` — ${detail}` : ''}`)
}
const msg = (r: Res) => String(r.body.error ?? r.body.message ?? '').slice(0, 220)
const safe = (r: Res, what: string) => { const l = leaks(r.text); check(l.length === 0, `${what}: la respuesta no filtra ${l.length ? l.join(', ') : 'PEM, tokens ni trazas'}`) }

const issuerData = { commercialAddress: 'Calle de Prueba 123, Córdoba', activityStartDate: '2020-01-01' }

async function register(email: string): Promise<string> {
  const r = await call('POST', '/api/auth/register', undefined, { email, password: PASSWORD })
  if (r.status !== 201) throw new Error(`registro falló: HTTP ${r.status} ${msg(r)}`)
  return r.body.token as string
}

async function draftInvoice(token: string): Promise<{ invoiceId: number; pointOfSaleId: number }> {
  // Si la organización ya trae el punto de venta 1 (409), se reutiliza.
  let pos: Res = await call('POST', '/api/points-of-sale', token, { number: 1 })
  if (pos.status === 409) {
    const listed = await call('GET', '/api/points-of-sale', token)
    const rows: Json[] = Array.isArray(listed.body) ? listed.body : (listed.body.items ?? [])
    const existing = rows.find((row) => row.number === 1)
    if (existing) pos = { status: 201, body: existing, text: '' }
  }
  if (pos.status !== 201) throw new Error(`punto de venta falló: HTTP ${pos.status} ${msg(pos)}`)
  const draft = await call('POST', '/api/invoices', token, {
    pointOfSaleId: pos.body.id,
    concept: 'PRODUCTOS',
    issueDate: new Date().toISOString().slice(0, 10),
    items: [{ description: 'Journey', quantity: 1, unitPrice: 100 }],
  })
  if (draft.status !== 201) throw new Error(`borrador falló: HTTP ${draft.status} ${msg(draft)}`)
  return { invoiceId: draft.body.invoiceId as number, pointOfSaleId: pos.body.id as number }
}

async function invoiceState(token: string, id: number) {
  const r = await call('GET', `/api/invoices/${id}`, token)
  return { status: r.body.status as string, voucherNumber: r.body.voucherNumber as number | null, http: r.status, cae: r.body.cae }
}

async function cleanup(emails: string[]) {
  const users = await prisma.user.findMany({ where: { email: { in: emails } }, select: { id: true } })
  const userIds = users.map((u) => u.id)
  const orgs = await prisma.organization.findMany({ where: { userId: { in: userIds } }, select: { id: true } })
  const orgIds = orgs.map((o) => o.id)
  const invoices = await prisma.invoice.findMany({ where: { organizationId: { in: orgIds } }, select: { id: true } })
  const invoiceIds = invoices.map((i) => i.id)
  await prisma.transaction.deleteMany({ where: { organizationId: { in: orgIds } } })
  await prisma.payment.deleteMany({ where: { invoiceId: { in: invoiceIds } } })
  await prisma.invoice.deleteMany({ where: { id: { in: invoiceIds } } }) // los ítems caen en cascada
  await prisma.client.deleteMany({ where: { organizationId: { in: orgIds } } })
  await prisma.pointOfSale.deleteMany({ where: { organizationId: { in: orgIds } } })
  await prisma.activity.deleteMany({ where: { organizationId: { in: orgIds } } })
  await prisma.category.deleteMany({ where: { organizationId: { in: orgIds } } })
  await prisma.auditLog.deleteMany({ where: { OR: [{ organizationId: { in: orgIds } }, { userId: { in: userIds } }] } })
  await prisma.arcaCsrRequest.deleteMany({ where: { organizationId: { in: orgIds } } })
  await prisma.arcaCredential.deleteMany({ where: { organizationId: { in: orgIds } } })
  await prisma.organization.deleteMany({ where: { id: { in: orgIds } } })
  await prisma.user.deleteMany({ where: { id: { in: userIds } } }) // los tokens de recuperación caen en cascada
}

async function journey(emailA: string, emailB: string) {
  const ca = await createThrowawayCa()
  const cuitA = randomCuit(validCuitFrom)
  let cuitB = randomCuit(validCuitFrom)
  while (cuitB === cuitA) cuitB = randomCuit(validCuitFrom)

  // 1
  step('1 registro y login')
  const tokenA = await register(emailA)
  const login = await call('POST', '/api/auth/login', undefined, { email: emailA, password: PASSWORD })
  check(login.status === 200 && !!login.body.token, 'login con el usuario nuevo', `HTTP ${login.status}`)
  const early = await call('GET', '/api/organizations/me', tokenA)
  check(early.status === 403, 'GET /organizations/me antes de crear la organización → 403', `HTTP ${early.status}`)

  // 2
  step('2 organización sin datos del emisor')
  const org = await call('POST', '/api/organizations', tokenA, { cuit: cuitA, legalName: 'Journey Cliente SA', taxCondition: 'MONOTRIBUTO', baseCurrency: 'ARS' })
  check(org.status === 201, 'organización creada sin domicilio ni inicio de actividades', `HTTP ${org.status}`)
  const mine = await call('GET', '/api/organizations/me', tokenA)
  const missing = (mine.body.issuerCompleteness?.missing ?? []).map((m: Json) => m.field).sort()
  check(mine.body.issuerCompleteness?.complete === false, 'issuerCompleteness.complete = false')
  check(missing.includes('commercialAddress') && missing.includes('activityStartDate'), 'faltan commercialAddress y activityStartDate', missing.join(','))

  const { invoiceId } = await draftInvoice(tokenA)
  const ticketsBefore = await prisma.arcaWsaaTicket.count()

  // 3
  step('3 autorizar con datos incompletos')
  const incomplete = await call('POST', `/api/invoices/${invoiceId}/authorize`, tokenA)
  const code = incomplete.body.code as string | undefined
  check(
    (incomplete.status === 422 && code === 'ISSUER_INCOMPLETE') || incomplete.status === 503,
    'responde 422 ISSUER_INCOMPLETE o, sin credencial cargada, 503 (el proveedor se arma antes de validar al emisor)',
    `HTTP ${incomplete.status} code=${code ?? '-'} ${msg(incomplete)}`,
  )
  safe(incomplete, 'autorizar incompleto')
  const afterIncomplete = await invoiceState(tokenA, invoiceId)
  check(afterIncomplete.status === 'DRAFT' && afterIncomplete.voucherNumber == null, 'la factura sigue en DRAFT sin número de comprobante', `${afterIncomplete.status} #${afterIncomplete.voucherNumber ?? '-'}`)
  const list = await call('GET', '/api/invoices', tokenA)
  const rows: Json[] = Array.isArray(list.body) ? list.body : (list.body.items ?? [])
  check(!rows.some((r) => r.status === 'PENDING'), 'no hay facturas PENDING')

  // 4
  step('4 completar datos del emisor')
  const patch = await call('PATCH', '/api/organizations/me', tokenA, issuerData)
  check(patch.status === 200, 'PATCH con domicilio e inicio de actividades', `HTTP ${patch.status}`)
  const done = await call('GET', '/api/organizations/me', tokenA)
  check(done.body.issuerCompleteness?.complete === true && done.body.issuerCompleteness.missing.length === 0, 'issuerCompleteness.complete = true')

  // 5
  step('5 autorizar sin credencial')
  const noCred = await call('POST', `/api/invoices/${invoiceId}/authorize`, tokenA)
  check(noCred.status === 503, '503 sin credencial', `HTTP ${noCred.status}`)
  check(/todavía no cargó su credencial/.test(msg(noCred)), 'mensaje claro: «todavía no cargó su credencial»', msg(noCred))
  safe(noCred, 'autorizar sin credencial')
  check((await invoiceState(tokenA, invoiceId)).status === 'DRAFT', 'la factura sigue en DRAFT')

  // 6
  step('6 solicitud de certificado (CSR)')
  const csr1 = await call('POST', '/api/organizations/me/arca-credential/csr', tokenA)
  const pem1: string = csr1.body.csr ?? ''
  check(csr1.status === 201 && /^-----BEGIN CERTIFICATE REQUEST-----/.test(pem1), 'POST /csr → 201 con PEM CERTIFICATE REQUEST', `HTTP ${csr1.status}`)
  check(!/PRIVATE KEY/.test(csr1.text), 'la respuesta no contiene la clave privada')
  const st1 = await call('GET', '/api/organizations/me/arca-credential', tokenA)
  check(st1.body.configured === false && st1.body.pendingCsr?.csr === pem1, 'estado: configured=false y pendingCsr = el CSR generado')
  const c1 = readCsr(pem1)
  check(c1.country[0] === 'AR', 'sujeto C=AR', c1.country.join())
  check(!!c1.organization[0], 'sujeto con O', c1.organization.join())
  check(!!c1.commonName[0] && !c1.commonName[0].includes('-'), 'CN sin guion', c1.commonName.join())
  check(c1.serialNumber[0] === `CUIT ${cuitA}`, 'serialNumber = «CUIT <cuit>»', c1.serialNumber.join())
  const csr2 = await call('POST', '/api/organizations/me/arca-credential/csr', tokenA)
  const pem2: string = csr2.body.csr ?? ''
  check(csr2.status === 201 && pem2 !== pem1, 'regenerar devuelve un CSR distinto')
  const st2 = await call('GET', '/api/organizations/me/arca-credential', tokenA)
  check(st2.body.pendingCsr?.csr === pem2, 'queda un solo pendiente: el último')
  check((await prisma.arcaCsrRequest.count({ where: { organization: { userId: (await prisma.user.findUniqueOrThrow({ where: { email: emailA } })).id } } })) === 1, 'en la base hay una sola fila de solicitud')
  const c2 = readCsr(pem2)

  // 7
  step('7 carga del certificado')
  const attach = (certificate: string) => call('POST', '/api/organizations/me/arca-credential/certificate', tokenA, { certificate })
  const oldCert = await ca.issue({ publicKey: c1.publicKey, cuit: cuitA })
  const r1 = await attach(oldCert)
  check(r1.status === 422, 'certificado del CSR VIEJO → 422', `HTTP ${r1.status} ${msg(r1)}`)
  const otherCuit = cuitA === cuitB ? randomCuit(validCuitFrom) : cuitB
  const r2 = await attach(await ca.issue({ publicKey: c2.publicKey, cuit: otherCuit }))
  check(r2.status === 422, 'certificado del CSR actual con OTRO CUIT → 422', `HTTP ${r2.status} ${msg(r2)}`)
  const r3 = await attach(await ca.issue({ publicKey: c2.publicKey, cuit: cuitA, notBefore: new Date(Date.now() - 400 * 864e5), notAfter: new Date(Date.now() - 864e5) }))
  check(r3.status === 422, 'certificado vencido → 422', `HTTP ${r3.status} ${msg(r3)}`)
  const keyPair = await ca.issuePair({ cuit: cuitA })
  const r4 = await attach(keyPair.privateKey)
  const keyBody = keyPair.privateKey.split('\n')[1]
  check(r4.status >= 400 && r4.status < 500, 'una clave privada pegada como certificado → 4xx', `HTTP ${r4.status} ${msg(r4)}`)
  check(!r4.text.includes(keyBody) && !/PRIVATE KEY/.test(r4.text), 'la respuesta no repite la clave pegada')
  for (const r of [r1, r2, r3]) safe(r, 'rechazo de certificado')
  const stillPending = await call('GET', '/api/organizations/me/arca-credential', tokenA)
  check(stillPending.body.configured === false && stillPending.body.pendingCsr?.csr === pem2, 'tras los rechazos sigue configured=false con el pendiente intacto')
  const goodCert = await ca.issue({ publicKey: c2.publicKey, cuit: cuitA })
  const ok = await attach(goodCert)
  check(ok.status === 200 && ok.body.configured === true, 'certificado correcto → 200 configured=true', `HTTP ${ok.status} ${ok.status === 200 ? '' : msg(ok)}`)
  check(!!ok.body.certificateExpiresAt && new Date(ok.body.certificateExpiresAt) > new Date(), 'devuelve vencimiento futuro', ok.body.certificateExpiresAt)
  check(!/PRIVATE KEY/.test(ok.text), 'la respuesta no incluye la clave')
  const stOk = await call('GET', '/api/organizations/me/arca-credential', tokenA)
  check(stOk.body.configured === true && stOk.body.pendingCsr === undefined, 'el pendiente se limpió')
  const again = await attach(goodCert)
  check(again.status === 422 && /Primero generá/.test(msg(again)), 'segunda carga → 422 «Primero generá…»', `HTTP ${again.status} ${msg(again)}`)

  // 8
  step('8 autorizar con certificado de CA no confiable')
  const t0 = Date.now()
  const auth = await call('POST', `/api/invoices/${invoiceId}/authorize`, tokenA)
  const secs = ((Date.now() - t0) / 1000).toFixed(1)
  console.log(`INFO  [8] observado: HTTP ${auth.status} en ${secs}s, error="${msg(auth)}", code=${auth.body.code ?? '-'}, fiscal.outcome=${auth.body.fiscal?.outcome ?? '-'}`)
  check(auth.status >= 500 && auth.status <= 599, 'ARCA rechaza: respuesta 5xx controlada', `HTTP ${auth.status}`)
  safe(auth, 'autorizar con CA no confiable')
  const afterAuth = await invoiceState(tokenA, invoiceId)
  console.log(`INFO  [8] factura tras el intento: status=${afterAuth.status} voucherNumber=${afterAuth.voucherNumber ?? '-'} cae=${afterAuth.cae ?? '-'}`)
  check(afterAuth.status !== 'AUTHORIZED' && !afterAuth.cae, 'la factura NO quedó autorizada ni con CAE', afterAuth.status)
  // Hallazgo de backend (no cuenta como FAIL): tras un fallo de autenticación con ARCA la factura queda PENDING y, como
  // solo se factura un borrador, el usuario no puede reintentar.
  console.log(`${afterAuth.status === 'DRAFT' ? 'PASS' : 'WARN'}  [${current}] la factura vuelve a DRAFT para poder reintentar — ${afterAuth.status}`)
  const ticketsAfter = await prisma.arcaWsaaTicket.count()
  check(ticketsAfter === ticketsBefore, 'el almacén de tickets no guardó ningún ticket', `${ticketsBefore} → ${ticketsAfter}`)

  // 9
  step('9 aislamiento entre organizaciones')
  const tokenB = await register(emailB)
  const orgB = await call('POST', '/api/organizations', tokenB, { cuit: cuitB, legalName: 'Journey Otro SA', taxCondition: 'MONOTRIBUTO', baseCurrency: 'ARS' })
  check(orgB.status === 201, 'organización B creada (incompleta a propósito)', `HTTP ${orgB.status}`)
  const csrB = await call('POST', '/api/organizations/me/arca-credential/csr', tokenA)
  const stB = await call('GET', '/api/organizations/me/arca-credential', tokenB)
  check(stB.body.configured === false && stB.body.pendingCsr === undefined, 'B no ve el estado, la credencial ni el pendiente de A', JSON.stringify({ configured: stB.body.configured, pending: !!stB.body.pendingCsr }))
  check(!stB.text.includes(csrB.body.csr ?? 'x'), 'la respuesta de B no contiene el CSR de A')
  const crossAuth = await call('POST', `/api/invoices/${invoiceId}/authorize`, tokenB)
  // B todavía no tiene credencial: el proveedor se arma antes de buscar la factura, así que acá responde 503 (sin tocar la de A).
  check([403, 404, 503].includes(crossAuth.status), 'B (sin credencial) autorizando la factura de A → 403/404/503', `HTTP ${crossAuth.status}`)
  const crossGet = await call('GET', `/api/invoices/${invoiceId}`, tokenB)
  check([403, 404].includes(crossGet.status), 'B leyendo la factura de A → 403/404', `HTTP ${crossGet.status}`)
  const stAfterB = await call('GET', '/api/organizations/me/arca-credential', tokenA)
  check(stAfterB.body.configured === true && stAfterB.body.pendingCsr?.csr === csrB.body.csr, 'A conserva su credencial y su propio pendiente (regeneró para probar)')

  // 11 (usa B, que tiene datos incompletos: también cubre ISSUER_INCOMPLETE con credencial cargada)
  step('11 endpoint directo {certificate, privateKey} y emisor incompleto')
  const pairB = await ca.issuePair({ cuit: cuitB })
  const direct = await call('POST', '/api/organizations/me/arca-credential', tokenB, pairB)
  check(direct.status === 200 && direct.body.configured === true, 'endpoint directo con un par que coincide → 200', `HTTP ${direct.status} ${direct.status === 200 ? '' : msg(direct)}`)
  const badPair = await call('POST', '/api/organizations/me/arca-credential', tokenB, { certificate: pairB.certificate, privateKey: (await ca.issuePair({ cuit: cuitB })).privateKey })
  check(badPair.status === 422 && !/PRIVATE KEY/.test(badPair.text), 'un par que no coincide → 422 sin eco de la clave', `HTTP ${badPair.status}`)
  const wrongCuit = await call('POST', '/api/organizations/me/arca-credential', tokenB, await ca.issuePair({ cuit: cuitA }))
  check(wrongCuit.status === 422, 'un par con el CUIT de otra organización → 422', `HTTP ${wrongCuit.status}`)
  const invB = await draftInvoice(tokenB)
  const incB = await call('POST', `/api/invoices/${invB.invoiceId}/authorize`, tokenB)
  check(incB.status === 422 && incB.body.code === 'ISSUER_INCOMPLETE', 'con credencial pero emisor incompleto → 422 ISSUER_INCOMPLETE', `HTTP ${incB.status} code=${incB.body.code ?? '-'} ${msg(incB)}`)
  check(Array.isArray(incB.body.missing) && incB.body.missing.includes('commercialAddress') && incB.body.missing.includes('activityStartDate'), 'lista los campos faltantes', JSON.stringify(incB.body.missing))
  const stB2 = await invoiceState(tokenB, invB.invoiceId)
  check(stB2.status === 'DRAFT' && stB2.voucherNumber == null, 'la factura de B sigue DRAFT sin número', `${stB2.status} #${stB2.voucherNumber ?? '-'}`)
  // Con credencial y emisor completos, B llega a buscar la factura: la de A no existe para B.
  await call('PATCH', '/api/organizations/me', tokenB, issuerData)
  const crossAuth2 = await call('POST', `/api/invoices/${invoiceId}/authorize`, tokenB)
  check([403, 404].includes(crossAuth2.status), 'B (credencial y emisor completos) autorizando la factura de A → 403/404', `HTTP ${crossAuth2.status} ${msg(crossAuth2)}`)
  check((await invoiceState(tokenA, invoiceId)).status === afterAuth.status, 'la factura de A no cambió de estado')

  // 10
  step('10 baja de la credencial')
  const del1 = await call('DELETE', '/api/organizations/me/arca-credential', tokenA)
  check(del1.status === 204, 'DELETE → 204', `HTTP ${del1.status}`)
  const stDel = await call('GET', '/api/organizations/me/arca-credential', tokenA)
  check(stDel.body.configured === false && stDel.body.pendingCsr === undefined, 'configured=false y sin pendiente')
  const del2 = await call('DELETE', '/api/organizations/me/arca-credential', tokenA)
  check(del2.status === 204, 'segundo DELETE idempotente → 204', `HTTP ${del2.status}`)
  const again503 = await call('POST', `/api/invoices/${invoiceId}/authorize`, tokenA)
  check(again503.status === 503 && /todavía no cargó su credencial/.test(msg(again503)), 'autorizar de nuevo → 503 claro', `HTTP ${again503.status} ${msg(again503)}`)

  // 12
  step('12 sin autenticación')
  for (const [method, path] of [
    ['GET', '/api/organizations/me/arca-credential'],
    ['POST', '/api/organizations/me/arca-credential/csr'],
    ['POST', '/api/organizations/me/arca-credential/certificate'],
  ] as const) {
    const r = await call(method, path, undefined, method === 'POST' ? {} : undefined)
    check(r.status === 401, `${method} ${path} sin token → 401`, `HTTP ${r.status}`)
  }
}

async function main() {
  if (!LOCAL_HOSTS.includes(new URL(BASE_URL).hostname)) throw new Error('Este recorrido solo corre contra un backend local (localhost).')
  if (process.env.ARCA_MODE === 'produccion') throw new Error('ARCA_MODE=produccion no está permitido en este recorrido.')
  let dbHost = ''
  try { dbHost = new URL(process.env.DATABASE_URL ?? '').hostname } catch { /* se rechaza abajo */ }
  if (!LOCAL_HOSTS.includes(dbHost)) throw new Error('Este recorrido solo usa una base local: DATABASE_URL tiene que apuntar a localhost.')
  const health = await call('GET', '/health')
  if (health.status !== 200) throw new Error(`el backend local no responde (HTTP ${health.status})`)

  const tag = Math.random().toString(36).slice(2, 10)
  const emailA = `journey-${tag}-a@test.local`
  const emailB = `journey-${tag}-b@test.local`
  try {
    await journey(emailA, emailB)
  } catch (error) {
    failures += 1
    console.log(`FAIL  [${current || 'inicio'}] excepción: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    await cleanup([emailA, emailB])
    const left = await prisma.user.count({ where: { email: { in: [emailA, emailB] } } })
    const leftOrgs = await prisma.organization.count({ where: { legalName: { in: ['Journey Cliente SA', 'Journey Otro SA'] } } })
    const pattern = await prisma.user.count({ where: { email: { startsWith: 'journey-', endsWith: '@test.local' } } })
    current = 'limpieza'
    check(left === 0, 'los usuarios de esta corrida se borraron', `restantes=${left}`)
    console.log(`INFO  [limpieza] usuarios journey-*@test.local en la base: ${pattern}; organizaciones «Journey …»: ${leftOrgs}`)
    await prisma.$disconnect()
  }
  console.log(failures === 0 ? '\nRESULTADO: TODO PASS' : `\nRESULTADO: ${failures} FAIL`)
  process.exit(failures === 0 ? 0 : 1)
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error))
  process.exit(1)
})
