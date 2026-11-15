import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest'
import { DbWsaaSessionStore } from './db-wsaa-session-store.js'


// Integración contra PostgreSQL: se saltea si no hay base configurada.
const hasDb = Boolean(process.env.DATABASE_URL)
const ENCRYPTION_KEY = Buffer.alloc(32, 7)
const inTwelveHours = () => new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()

describe.skipIf(!hasDb)('DbWsaaSessionStore', () => {
  let prisma: (typeof import('../../../lib/prisma.js'))['prisma']
  let store: DbWsaaSessionStore
  // Huella única por test: los archivos de test corren en paralelo contra la misma base.
  let key: { environment: 'test'; service: 'wsfe'; certificateFingerprint: string }
  const used: string[] = []

  beforeAll(async () => {
    ;({ prisma } = await import('../../../lib/prisma.js'))
  })
  afterEach(async () => {
    await prisma.arcaWsaaTicket.deleteMany({ where: { id: { in: used.splice(0) } } })
  })
  afterAll(() => prisma?.$disconnect())

  const newKey = () => {
    key = { environment: 'test', service: 'wsfe', certificateFingerprint: randomUUID() }
    used.push(DbWsaaSessionStore.idFor(key))
    store = new DbWsaaSessionStore(prisma, ENCRYPTION_KEY)
    return key
  }

  it('guarda y devuelve el ticket, también desde otra instancia', async () => {
    newKey()
    const credentials = { token: 'T-secreto', sign: 'S-secreta', expiresAt: inTwelveHours() }
    await store.set(key, credentials)

    expect(await new DbWsaaSessionStore(prisma, ENCRYPTION_KEY).get(key)).toEqual(credentials)
  })

  it('set reemplaza el ticket anterior', async () => {
    newKey()
    await store.set(key, { token: 'A', sign: 'A', expiresAt: inTwelveHours() })
    const next = { token: 'B', sign: 'B', expiresAt: inTwelveHours() }
    await store.set(key, next)

    expect(await store.get(key)).toEqual(next)
  })

  it('no mezcla tickets de otro certificado o de otro ambiente', async () => {
    newKey()
    await store.set(key, { token: 'T', sign: 'S', expiresAt: inTwelveHours() })

    expect(await store.get({ ...key, certificateFingerprint: 'otro' })).toBeNull()
    expect(await store.get({ ...key, environment: 'production' } as never)).toBeNull()
  })

  it('descarta un ticket vencido o dentro del margen de 60 s y borra la fila', async () => {
    newKey()
    await store.set(key, { token: 'T', sign: 'S', expiresAt: new Date(Date.now() + 30_000).toISOString() })

    expect(await store.get(key)).toBeNull()
    expect(await prisma.arcaWsaaTicket.count({ where: { id: DbWsaaSessionStore.idFor(key) } })).toBe(0)
  })

  it('un ticket con más de 60 s de vida sigue siendo válido', async () => {
    newKey()
    const credentials = { token: 'T', sign: 'S', expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() }
    await store.set(key, credentials)

    expect(await store.get(key)).toEqual(credentials)
  })

  it('no guarda el token ni la firma en texto plano', async () => {
    newKey()
    await store.set(key, { token: 'TOKEN-EN-CLARO', sign: 'FIRMA-EN-CLARA', expiresAt: inTwelveHours() })

    const rows = await prisma.$queryRaw<Array<Record<string, unknown>>>`SELECT * FROM arca_wsaa_tickets WHERE id = ${DbWsaaSessionStore.idFor(key)}`
    expect(rows).toHaveLength(1)
    const raw = JSON.stringify(rows[0])
    expect(raw).not.toContain('TOKEN-EN-CLARO')
    expect(raw).not.toContain('FIRMA-EN-CLARA')
  })

  it('con otra clave de cifrado se trata como si no hubiera ticket y se borra la fila', async () => {
    newKey()
    await store.set(key, { token: 'T', sign: 'S', expiresAt: inTwelveHours() })

    const otherKey = new DbWsaaSessionStore(prisma, randomBytes(32))
    expect(await otherKey.get(key)).toBeNull()
    expect(await prisma.arcaWsaaTicket.count({ where: { id: DbWsaaSessionStore.idFor(key) } })).toBe(0)
  })

  it('una fila copiada a otro id no se descifra (el dato asociado la ata a su id)', async () => {
    newKey()
    await store.set(key, { token: 'T', sign: 'S', expiresAt: inTwelveHours() })
    const original = await prisma.arcaWsaaTicket.findUniqueOrThrow({ where: { id: DbWsaaSessionStore.idFor(key) } })
    const other = { ...key, certificateFingerprint: randomUUID() }
    const otherId = DbWsaaSessionStore.idFor(other)
    used.push(otherId)
    await prisma.arcaWsaaTicket.create({ data: { ...original, id: otherId } })

    expect(await store.get(other)).toBeNull()
  })

  it('un registro alterado se trata como si no hubiera ticket', async () => {
    newKey()
    await store.set(key, { token: 'T', sign: 'S', expiresAt: inTwelveHours() })
    await prisma.arcaWsaaTicket.update({ where: { id: DbWsaaSessionStore.idFor(key) }, data: { tokenEncrypted: 'v1.AAAA.AAAA.AAAA' } })

    expect(await store.get(key)).toBeNull()
  })

  it('delete borra el ticket', async () => {
    newKey()
    await store.set(key, { token: 'T', sign: 'S', expiresAt: inTwelveHours() })
    await store.delete(key)

    expect(await store.get(key)).toBeNull()
  })

  it('withLock serializa entre dos instancias del almacén (como dos procesos)', async () => {
    newKey()
    const a = new DbWsaaSessionStore(prisma, ENCRYPTION_KEY)
    const b = new DbWsaaSessionStore(prisma, ENCRYPTION_KEY)
    let running = 0
    let overlapped = false
    const order: string[] = []
    const critical = (name: string) => async () => {
      running++
      if (running > 1) overlapped = true
      order.push(`${name}:start`)
      await new Promise((resolve) => setTimeout(resolve, 150))
      order.push(`${name}:end`)
      running--
      return name
    }

    const results = await Promise.all([a.withLock(key, critical('a')), b.withLock(key, critical('b')), a.withLock(key, critical('c'))])

    expect(results).toEqual(['a', 'b', 'c'])
    expect(overlapped).toBe(false)
    expect(order.filter((_, i) => i % 2 === 0).every((entry) => entry.endsWith(':start'))).toBe(true)
  })

  it('withLock no bloquea claves distintas y libera el bloqueo si la función falla', async () => {
    newKey()
    await expect(store.withLock(key, async () => Promise.reject(new Error('falló ARCA')))).rejects.toThrow('falló ARCA')
    expect(await store.withLock(key, async () => 'sigue andando')).toBe('sigue andando')
  })
})
