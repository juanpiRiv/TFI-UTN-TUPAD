import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { PrismaPg } from '@prisma/adapter-pg'
import { aadFor, csrAadFor } from './arca-credential.service.js'
import { rotateEncryptionKey } from './key-rotation.js'
import { decryptSecret, encryptSecret } from './secret-box.js'

/**
 * Rotación de clave contra PostgreSQL real, con transacciones de verdad. Corre en un esquema propio y descartable
 * (copia de las tres tablas): la rotación recorre TODAS las filas y descarta las que no puede leer, así que nunca
 * debe apuntar a las tablas compartidas con otros tests ni con el servidor de desarrollo.
 */
const hasDb = Boolean(process.env.DATABASE_URL)
const hex = () => randomBytes(32).toString('hex')
const PEM = '-----BEGIN PRIVATE KEY-----\nclave-de-prueba\n-----END PRIVATE KEY-----'
const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000)

describe.skipIf(!hasDb)('rotateEncryptionKey (base real, esquema aislado)', () => {
  const schema = `rot_${randomUUID().replace(/-/g, '').slice(0, 12)}`
  let admin: (typeof import('../../lib/prisma.js'))['prisma']
  let db: InstanceType<(typeof import('../../generated/prisma/client.js'))['PrismaClient']>
  let oldHex: string
  let newHex: string

  beforeAll(async () => {
    ;({ prisma: admin } = await import('../../lib/prisma.js'))
    const { PrismaClient } = await import('../../generated/prisma/client.js')
    await admin.$executeRawUnsafe(`CREATE SCHEMA "${schema}"`)
    for (const table of ['arca_credentials', 'arca_csr_requests', 'arca_wsaa_tickets']) {
      await admin.$executeRawUnsafe(`CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING DEFAULTS INCLUDING INDEXES)`)
    }
    // Prisma castea la columna al tipo enumerado del esquema: se crea uno propio y se le pasa la columna.
    await admin.$executeRawUnsafe(`CREATE TYPE "${schema}"."ArcaEnvironment" AS ENUM ('HOMOLOGACION', 'PRODUCCION')`)
    await admin.$executeRawUnsafe(
      `ALTER TABLE "${schema}"."arca_credentials" ALTER COLUMN environment DROP DEFAULT, ALTER COLUMN environment TYPE "${schema}"."ArcaEnvironment" USING environment::text::"${schema}"."ArcaEnvironment", ALTER COLUMN environment SET DEFAULT 'HOMOLOGACION'`,
    )
    db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }, { schema }) })
  })

  afterAll(async () => {
    await db?.$disconnect()
    await admin?.$executeRawUnsafe(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
    await admin?.$disconnect()
  })

  beforeEach(async () => {
    oldHex = hex()
    newHex = hex()
    await db.arcaCredential.deleteMany()
    await db.arcaCsrRequest.deleteMany()
    await db.arcaWsaaTicket.deleteMany()
  })

  const oldKey = () => Buffer.from(oldHex, 'hex')
  const newKey = () => Buffer.from(newHex, 'hex')
  const credential = (organizationId: number, key = oldKey(), aadOrg = organizationId) =>
    db.arcaCredential.create({
      data: { organizationId, certificate: 'cert', privateKeyEncrypted: encryptSecret(PEM, key, aadFor(aadOrg)) },
    })
  const csr = (organizationId: number, key = oldKey(), aadOrg = organizationId) =>
    db.arcaCsrRequest.create({ data: { organizationId, csr: 'csr', privateKeyEncrypted: encryptSecret(PEM, key, csrAadFor(aadOrg)) } })
  const ticket = (key = oldKey(), expiresAt = inHours(6)) => {
    const id = randomBytes(32).toString('hex')
    const aad = `arca-wsaa:${id}`
    return db.arcaWsaaTicket.create({
      data: { id, environment: 'test', service: 'wsfe', tokenEncrypted: encryptSecret('TOKEN', key, aad), signEncrypted: encryptSecret('SIGN', key, aad), expiresAt },
    })
  }
  const snapshot = async () => ({
    credentials: await db.arcaCredential.findMany({ orderBy: { id: 'asc' } }),
    requests: await db.arcaCsrRequest.findMany({ orderBy: { id: 'asc' } }),
    tickets: await db.arcaWsaaTicket.findMany({ orderBy: { id: 'asc' } }),
  })
  const run = (apply: boolean, o = oldHex, n = newHex) => rotateEncryptionKey(db, { oldKeyHex: o, newKeyHex: n, apply })

  it('con las tablas vacías no hay nada que rotar y no falla', async () => {
    expect(await run(true)).toEqual({ rotated: 0, alreadyRotated: 0, ticketsRotated: 0, ticketsDiscarded: 0, csrRotated: 0, csrAlreadyRotated: 0, csrDiscarded: 0, dryRun: false })
    expect((await run(false)).dryRun).toBe(true)
  })

  it('rota credenciales, tickets y solicitudes pendientes en una sola corrida, y todo se lee con la clave nueva', async () => {
    const c1 = await credential(101)
    const c2 = await credential(102)
    const t1 = await ticket()
    const stale = await ticket(oldKey(), new Date(Date.now() - 1000))
    const unreadable = await ticket(Buffer.from(hex(), 'hex'))
    const r1 = await csr(101)
    const rBad = await csr(102, Buffer.from(hex(), 'hex'))

    const report = await run(true)

    expect(report).toEqual({ rotated: 2, alreadyRotated: 0, ticketsRotated: 1, ticketsDiscarded: 2, csrRotated: 1, csrAlreadyRotated: 0, csrDiscarded: 1, dryRun: false })
    for (const [row, org] of [[c1, 101], [c2, 102]] as const) {
      const saved = await db.arcaCredential.findUniqueOrThrow({ where: { id: row.id } })
      expect(decryptSecret(saved.privateKeyEncrypted, newKey(), aadFor(org))).toBe(PEM)
      expect(() => decryptSecret(saved.privateKeyEncrypted, oldKey(), aadFor(org))).toThrow()
    }
    const savedTicket = await db.arcaWsaaTicket.findUniqueOrThrow({ where: { id: t1.id } })
    expect(decryptSecret(savedTicket.tokenEncrypted, newKey(), `arca-wsaa:${t1.id}`)).toBe('TOKEN')
    expect(decryptSecret(savedTicket.signEncrypted, newKey(), `arca-wsaa:${t1.id}`)).toBe('SIGN')
    expect(await db.arcaWsaaTicket.findUnique({ where: { id: stale.id } })).toBeNull()
    expect(await db.arcaWsaaTicket.findUnique({ where: { id: unreadable.id } })).toBeNull()
    const savedCsr = await db.arcaCsrRequest.findUniqueOrThrow({ where: { id: r1.id } })
    expect(decryptSecret(savedCsr.privateKeyEncrypted, newKey(), csrAadFor(101))).toBe(PEM)
    expect(await db.arcaCsrRequest.findUnique({ where: { id: rBad.id } })).toBeNull()
  })

  it('es idempotente: la segunda corrida no cambia ni un byte y cuenta lo ya rotado', async () => {
    await credential(201)
    await csr(201)
    await ticket()
    await run(true)
    const after = await snapshot()

    const again = await run(true)

    expect(again).toMatchObject({ rotated: 0, alreadyRotated: 1, csrRotated: 0, csrAlreadyRotated: 1, ticketsRotated: 0, ticketsDiscarded: 0, csrDiscarded: 0 })
    expect(await snapshot()).toEqual(after)
  })

  it('la simulación deja todas las filas idénticas byte a byte (incluso los vencidos e ilegibles que descartaría)', async () => {
    await credential(301)
    await csr(301)
    await csr(302, Buffer.from(hex(), 'hex'))
    await ticket()
    await ticket(oldKey(), new Date(Date.now() - 1000))
    const before = await snapshot()

    const report = await run(false)

    expect(report).toMatchObject({ dryRun: true, rotated: 1, csrRotated: 1, csrDiscarded: 1, ticketsRotated: 1, ticketsDiscarded: 1 })
    expect(await snapshot()).toEqual(before)
  })

  it('si una credencial no se descifra con ninguna clave, la transacción real se deshace: lo ya reescrito vuelve a su valor', async () => {
    const good = await credential(401)
    const good2 = await credential(402)
    const bad = await credential(403, Buffer.from(hex(), 'hex'))
    await csr(401)
    await ticket()
    const before = await snapshot()

    const error = await run(true).catch((e: Error) => e)

    expect(error).toBeInstanceOf(Error)
    expect((error as Error).message).toMatch(/403.*ni con la clave vieja ni con la nueva/)
    expect((error as Error).message).not.toContain(oldHex)
    expect((error as Error).message).not.toContain(newHex)
    expect(good.id).toBeLessThan(bad.id)
    expect(good2.id).toBeLessThan(bad.id)
    expect(await snapshot()).toEqual(before)
  })

  it('una credencial movida a otra organización (el dato asociado no coincide) se detecta y no se rota', async () => {
    await credential(501)
    await credential(502, oldKey(), 999)
    const before = await snapshot()

    await expect(run(true)).rejects.toThrow(/502/)
    expect(await snapshot()).toEqual(before)
  })

  it('una solicitud pendiente movida a otra organización se descarta y no se re-cifra como si fuera suya', async () => {
    const moved = await csr(601, oldKey(), 999)

    const report = await run(true)

    expect(report.csrDiscarded).toBe(1)
    expect(await db.arcaCsrRequest.findUnique({ where: { id: moved.id } })).toBeNull()
  })

  it('una credencial guardada como solicitud pendiente (dato asociado cruzado) no se descifra', async () => {
    const swapped = await db.arcaCsrRequest.create({ data: { organizationId: 701, csr: 'x', privateKeyEncrypted: encryptSecret(PEM, oldKey(), aadFor(701)) } })

    expect((await run(true)).csrDiscarded).toBe(1)
    expect(await db.arcaCsrRequest.findUnique({ where: { id: swapped.id } })).toBeNull()
  })

  it('un estado mezclado (parte ya con la clave nueva) se completa sin tocar lo que ya estaba rotado', async () => {
    const done = await credential(801, newKey())
    const pending = await credential(802)
    const doneBytes = done.privateKeyEncrypted

    const report = await run(true)

    expect(report).toMatchObject({ rotated: 1, alreadyRotated: 1 })
    expect((await db.arcaCredential.findUniqueOrThrow({ where: { id: done.id } })).privateKeyEncrypted).toBe(doneBytes)
    expect(decryptSecret((await db.arcaCredential.findUniqueOrThrow({ where: { id: pending.id } })).privateKeyEncrypted, newKey(), aadFor(802))).toBe(PEM)
  })

  it('una escritura ajena entre la lectura y la actualización no se pisa (el chequeo de la fila falla y todo se deshace)', async () => {
    // Simulamos a otro proceso con un cliente que cambia la fila justo después de que la rotación la leyó.
    const target = await credential(901)
    const other = await credential(902)
    const racing = {
      $transaction: (fn: (tx: any) => Promise<unknown>, options: unknown) =>
        db.$transaction(async (tx) => {
          const credentials = tx.arcaCredential
          const proxy = {
            arcaWsaaTicket: tx.arcaWsaaTicket,
            arcaCsrRequest: tx.arcaCsrRequest,
            arcaCredential: {
            findMany: async (args: never) => {
              const rows = await credentials.findMany(args)
              await admin.$executeRawUnsafe(`UPDATE "${schema}"."arca_credentials" SET private_key_encrypted = $1 WHERE id = $2`, encryptSecret(PEM, oldKey(), aadFor(901)), target.id)
              return rows
            },
            updateMany: (args: never) => credentials.updateMany(args),
            },
          }
          return fn(proxy)
        }, options as never),
    }
    const before = await db.arcaCredential.findUniqueOrThrow({ where: { id: other.id } })

    await expect(rotateEncryptionKey(racing as never, { oldKeyHex: oldHex, newKeyHex: newHex, apply: true })).rejects.toThrow(/cambió mientras se rotaba/)

    expect((await db.arcaCredential.findUniqueOrThrow({ where: { id: other.id } })).privateKeyEncrypted).toBe(before.privateKeyEncrypted)
  })

  it.each([
    ['clave vieja igual a la nueva', () => [oldHex, oldHex]],
    ['igual con distinta capitalización', () => [oldHex, oldHex.toUpperCase()]],
    ['vieja ausente', () => [undefined, newHex]],
    ['nueva ausente', () => [oldHex, undefined]],
    ['vieja vacía', () => ['', newHex]],
    ['nueva solo espacios', () => [oldHex, '   ']],
    ['vieja de 63 caracteres', () => [oldHex.slice(1), newHex]],
    ['nueva de 65 caracteres', () => [oldHex, `${newHex}a`]],
    ['nueva no hexadecimal', () => [oldHex, 'g'.repeat(64)]],
    ['vieja con prefijo 0x', () => [`0x${oldHex.slice(2)}`, newHex]],
  ])('rechaza %s antes de tocar nada', async (_name, keys) => {
    await credential(1001)
    const before = await snapshot()
    const [o, n] = keys() as [string | undefined, string | undefined]

    await expect(rotateEncryptionKey(db, { oldKeyHex: o, newKeyHex: n, apply: true })).rejects.toThrow()
    expect(await snapshot()).toEqual(before)
  })

  it('los mensajes de error no incluyen ninguna de las dos claves ni el texto descifrado', async () => {
    await credential(1101, Buffer.from(hex(), 'hex'))

    const error = (await run(true).catch((e: Error) => e)) as Error

    for (const secret of [oldHex, newHex, 'clave-de-prueba', 'PRIVATE KEY']) expect(error.message).not.toContain(secret)
  })
})
