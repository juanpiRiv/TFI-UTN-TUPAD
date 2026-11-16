import { randomBytes, randomUUID } from 'node:crypto'
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { DbWsaaSessionStore } from './db-wsaa-session-store.js'
import { encryptSecret } from '../secret-box.js'

// Estas pruebas dependen de tiempos reales (vencimientos de 300 ms y varias esperas seguidas): con la máquina cargada
// el límite por defecto de 5 s no alcanza.
vi.setConfig({ testTimeout: 30_000 })

// Casos límite del almacén del ticket de WSAA contra PostgreSQL real. Cada test usa huellas únicas: los archivos corren en paralelo.
const hasDb = Boolean(process.env.DATABASE_URL)
const KEY_A = Buffer.alloc(32, 1)
const KEY_B = Buffer.alloc(32, 2)
const inHours = (hours: number) => new Date(Date.now() + hours * 3_600_000)
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

describe('DbWsaaSessionStore.idFor', () => {
  const base = { environment: 'test', service: 'wsfe', certificateFingerprint: 'abc' } as const

  it('es distinto para otro ambiente, otro servicio y otra huella, y estable para la misma clave', () => {
    const ids = new Set([
      DbWsaaSessionStore.idFor(base),
      DbWsaaSessionStore.idFor({ ...base, environment: 'production' } as never),
      DbWsaaSessionStore.idFor({ ...base, service: 'ws_sr_padron_a13' } as never),
      DbWsaaSessionStore.idFor({ ...base, certificateFingerprint: 'abd' }),
    ])
    expect(ids.size).toBe(4)
    expect(DbWsaaSessionStore.idFor({ ...base })).toBe(DbWsaaSessionStore.idFor(base))
    expect(DbWsaaSessionStore.idFor(base)).toMatch(/^[0-9a-f]{64}$/)
  })

  it('no confunde campos contiguos (el límite entre ambiente, servicio y huella cuenta)', () => {
    const a = DbWsaaSessionStore.idFor({ environment: 'test', service: 'wsfe', certificateFingerprint: 'x' })
    const b = DbWsaaSessionStore.idFor({ environment: 'testwsfe', service: '', certificateFingerprint: 'x' } as never)
    const c = DbWsaaSessionStore.idFor({ environment: 'test', service: 'wsf', certificateFingerprint: 'ex' } as never)
    expect(new Set([a, b, c]).size).toBe(3)
  })
})

describe.skipIf(!hasDb)('DbWsaaSessionStore (casos límite, base real)', () => {
  let prisma: (typeof import('../../../lib/prisma.js'))['prisma']
  const used: string[] = []

  beforeAll(async () => {
    ;({ prisma } = await import('../../../lib/prisma.js'))
  })
  afterEach(async () => {
    await prisma.arcaWsaaTicket.deleteMany({ where: { id: { in: used.splice(0) } } })
  })
  afterAll(() => prisma?.$disconnect())

  const keyFor = (suffix: string = randomUUID()) => {
    const key = { environment: 'test' as const, service: 'wsfe' as const, certificateFingerprint: `edge-${suffix}` }
    used.push(DbWsaaSessionStore.idFor(key))
    return key
  }
  const rowOf = (key: ReturnType<typeof keyFor>) => prisma.arcaWsaaTicket.findUnique({ where: { id: DbWsaaSessionStore.idFor(key) } }) as Promise<any>

  describe('carreras entre instancias y claves', () => {
    it('muchos set a la vez de dos almacenes sobre la misma clave no fallan (sin violación de unicidad) y queda una fila', async () => {
      const key = keyFor()
      const a = new DbWsaaSessionStore(prisma, KEY_A)
      const b = new DbWsaaSessionStore(prisma, KEY_A)

      await Promise.all(
        Array.from({ length: 12 }, (_, i) => (i % 2 ? a : b).set(key, { token: `T${i}`, sign: `S${i}`, expiresAt: inHours(12).toISOString() })),
      )

      expect(await prisma.arcaWsaaTicket.count({ where: { id: DbWsaaSessionStore.idFor(key) } })).toBe(1)
      const read = await a.get(key)
      expect(read?.token).toMatch(/^T\d+$/)
      expect(read?.sign).toBe(read!.token.replace('T', 'S'))
    })

    it('dos almacenes con claves de cifrado distintas: gana el último que escribió, el otro lo ve como ausente y no borra nada', async () => {
      const key = keyFor()
      const withA = new DbWsaaSessionStore(prisma, KEY_A)
      const withB = new DbWsaaSessionStore(prisma, KEY_B)
      await withA.set(key, { token: 'de-A', sign: 'de-A', expiresAt: inHours(12).toISOString() })
      await withB.set(key, { token: 'de-B', sign: 'de-B', expiresAt: inHours(12).toISOString() })

      expect(await withA.get(key)).toBeNull()
      expect(await withB.get(key)).toMatchObject({ token: 'de-B' })
      expect(await rowOf(key)).not.toBeNull()
      // La instancia que no lo podía leer lo reemplaza con el siguiente set.
      await withA.set(key, { token: 'nuevo-A', sign: 'nuevo-A', expiresAt: inHours(12).toISOString() })
      expect(await withA.get(key)).toMatchObject({ token: 'nuevo-A' })
    })

    it('get y set simultáneos de claves distintas no se pisan', async () => {
      const keys = Array.from({ length: 6 }, () => keyFor())
      const store = new DbWsaaSessionStore(prisma, KEY_A)

      await Promise.all(keys.map((key, i) => store.set(key, { token: `T${i}`, sign: `S${i}`, expiresAt: inHours(12).toISOString() })))
      const read = await Promise.all(keys.map((key) => store.get(key)))

      expect(read.map((entry) => entry?.token)).toEqual(keys.map((_, i) => `T${i}`))
    })
  })

  describe('vencimiento', () => {
    /** Cliente que lee una fila vencida y, antes de que `get` la borre, otra instancia la renueva. */
    it('el borrado de un ticket vencido no se lleva uno recién renovado por otra instancia', async () => {
      const key = keyFor()
      const id = DbWsaaSessionStore.idFor(key)
      const aad = `arca-wsaa:${id}`
      const expiredAt = new Date(Date.now() - 5_000)
      await prisma.arcaWsaaTicket.create({
        data: { id, environment: 'test', service: 'wsfe', tokenEncrypted: encryptSecret('viejo', KEY_A, aad), signEncrypted: encryptSecret('viejo', KEY_A, aad), expiresAt: expiredAt },
      })
      const renewer = new DbWsaaSessionStore(prisma, KEY_A)
      const racing = {
        $transaction: prisma.$transaction.bind(prisma),
        arcaWsaaTicket: {
          findUnique: async (args: never) => {
            const stale = await prisma.arcaWsaaTicket.findUnique(args)
            // Entre la lectura y el borrado, otra instancia renueva el ticket.
            await renewer.set(key, { token: 'renovado', sign: 'renovado', expiresAt: inHours(12).toISOString() })
            return stale
          },
          deleteMany: (args: never) => prisma.arcaWsaaTicket.deleteMany(args),
        },
      }

      const result = await new DbWsaaSessionStore(racing as never, KEY_A).get(key)

      expect(result).toBeNull() // lo que leyó estaba vencido
      expect(await new DbWsaaSessionStore(prisma, KEY_A).get(key)).toMatchObject({ token: 'renovado' })
    })

    it('un ticket que vence justo dentro del margen de 60 s se descarta y se borra', async () => {
      const key = keyFor()
      const store = new DbWsaaSessionStore(prisma, KEY_A)
      await store.set(key, { token: 'T', sign: 'S', expiresAt: new Date(Date.now() + 59_000).toISOString() })

      expect(await store.get(key)).toBeNull()
      expect(await rowOf(key)).toBeNull()
    })

    it('set limpia los tickets vencidos de otros certificados pero no los vigentes', async () => {
      const stale = keyFor()
      const fresh = keyFor()
      const writer = new DbWsaaSessionStore(prisma, KEY_A)
      for (const [key, expiresAt] of [[stale, new Date(Date.now() - 1000)], [fresh, inHours(5)]] as const) {
        const id = DbWsaaSessionStore.idFor(key)
        await prisma.arcaWsaaTicket.create({ data: { id, environment: 'test', service: 'wsfe', tokenEncrypted: encryptSecret('x', KEY_A, `arca-wsaa:${id}`), signEncrypted: encryptSecret('x', KEY_A, `arca-wsaa:${id}`), expiresAt } })
      }

      await writer.set(keyFor(), { token: 'T', sign: 'S', expiresAt: inHours(12).toISOString() })

      expect(await rowOf(stale)).toBeNull()
      expect(await rowOf(fresh)).not.toBeNull()
    })
  })

  describe('registros ilegibles', () => {
    it('un registro que no se puede descifrar es un "no hay ticket" y NO se borra (aunque no sea de esta clave)', async () => {
      const key = keyFor()
      await new DbWsaaSessionStore(prisma, KEY_B).set(key, { token: 'de-B', sign: 'de-B', expiresAt: inHours(12).toISOString() })
      const before = await rowOf(key)
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(await new DbWsaaSessionStore(prisma, KEY_A).get(key)).toBeNull()

      const logged = error.mock.calls.flat().join(' ')
      error.mockRestore()
      expect(logged).not.toContain('de-B')
      expect(logged).not.toContain(before.tokenEncrypted)
      expect(await rowOf(key)).toEqual(before)
    })

    it.each(['tokenEncrypted', 'signEncrypted'] as const)('con %s alterado es un "no hay ticket" y la fila queda', async (column) => {
      const key = keyFor()
      const store = new DbWsaaSessionStore(prisma, KEY_A)
      await store.set(key, { token: 'T', sign: 'S', expiresAt: inHours(12).toISOString() })
      const row = await rowOf(key)
      const [version, iv, tag, encrypted] = row[column].split('.')
      const flipped = Buffer.from(encrypted, 'base64')
      flipped[0] = flipped[0]! ^ 0xff
      const tampered = [version, iv, tag, flipped.toString('base64')].join('.')
      await prisma.arcaWsaaTicket.update({ where: { id: row.id }, data: { [column]: tampered } })
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})

      expect(await store.get(key)).toBeNull()

      error.mockRestore()
      expect((await rowOf(key))[column]).toBe(tampered)
    })

    it.each(['', 'basura', 'v1...', 'v2.a.b.c'])('un valor guardado con formato roto (%j) no lanza: se trata como ausente', async (garbage) => {
      const key = keyFor()
      const store = new DbWsaaSessionStore(prisma, KEY_A)
      await store.set(key, { token: 'T', sign: 'S', expiresAt: inHours(12).toISOString() })
      await prisma.arcaWsaaTicket.update({ where: { id: DbWsaaSessionStore.idFor(key) }, data: { tokenEncrypted: garbage } })
      const error = vi.spyOn(console, 'error').mockImplementation(() => {})

      await expect(store.get(key)).resolves.toBeNull()
      error.mockRestore()
    })
  })

  describe('bloqueo (withLock)', () => {
    it('se libera si la función lanza: el siguiente pedido de la misma clave entra enseguida', async () => {
      const key = keyFor()
      const store = new DbWsaaSessionStore(prisma, KEY_A)
      await expect(store.withLock(key, async () => { throw new Error('ARCA caída') })).rejects.toThrow('ARCA caída')

      const started = Date.now()
      expect(await store.withLock(key, async () => 'libre')).toBe('libre')
      expect(Date.now() - started).toBeLessThan(2_000)
    })

    it('se libera cuando vence la transacción: otro almacén toma el bloqueo y la ranura del proceso se devuelve', async () => {
      const slow = (index: number) => new DbWsaaSessionStore(prisma, KEY_A, { transactionTimeoutMs: 300, maxWaitMs: 5_000 }).withLock(keyFor(`lento-${index}`), () => sleep(1_200))
      // Cuatro vencimientos seguidos: si cada uno dejara tomada su ranura (tope de 3), el quinto pedido no entraría nunca.
      for (let i = 0; i < 4; i++) await expect(slow(i)).rejects.toThrow()

      const started = Date.now()
      expect(await new DbWsaaSessionStore(prisma, KEY_A).withLock(keyFor('despues'), async () => 'entró')).toBe('entró')
      expect(Date.now() - started).toBeLessThan(15_000)
    })

    it('tras vencer la transacción de la clave, otro almacén puede tomar el mismo bloqueo', async () => {
      const key = keyFor()
      const first = new DbWsaaSessionStore(prisma, KEY_A, { transactionTimeoutMs: 300 })
      await expect(first.withLock(key, () => sleep(1_000))).rejects.toThrow()

      const started = Date.now()
      expect(await new DbWsaaSessionStore(prisma, KEY_B).withLock(key, async () => 'tomado')).toBe('tomado')
      expect(Date.now() - started).toBeLessThan(15_000)
    })

    it('con fallas en vuelo el tope sigue en 3 y todos los pedidos terminan', async () => {
      const keys = Array.from({ length: 9 }, () => keyFor())
      let running = 0
      let peak = 0
      const work = (index: number) => async () => {
        running++
        peak = Math.max(peak, running)
        await sleep(60)
        running--
        if (index % 2 === 0) throw new Error(`falla ${index}`)
        return index
      }

      const settled = await Promise.allSettled(keys.map((key, i) => new DbWsaaSessionStore(prisma, randomBytes(32)).withLock(key, work(i))))

      expect(peak).toBeLessThanOrEqual(3)
      expect(settled.filter((r) => r.status === 'rejected')).toHaveLength(5)
      expect(settled.filter((r) => r.status === 'fulfilled').map((r) => (r as PromiseFulfilledResult<number>).value)).toEqual([1, 3, 5, 7])
      // Y el proceso sigue pudiendo tomar bloqueos.
      expect(await new DbWsaaSessionStore(prisma, KEY_A).withLock(keyFor(), async () => 'ok')).toBe('ok')
    })

    it('un pedido que falla en la cola no hace fallar al siguiente de la misma clave y mantiene el orden', async () => {
      const key = keyFor()
      const store = new DbWsaaSessionStore(prisma, KEY_A)
      const order: string[] = []

      const results = await Promise.allSettled([
        store.withLock(key, async () => { order.push('1'); await sleep(40); throw new Error('uno') }),
        store.withLock(key, async () => { order.push('2'); return 'dos' }),
        store.withLock(key, async () => { order.push('3'); return 'tres' }),
      ])

      expect(order).toEqual(['1', '2', '3'])
      expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled', 'fulfilled'])
    })

    it('claves distintas no se bloquean entre sí', async () => {
      const [a, b] = [keyFor(), keyFor()]
      const store = new DbWsaaSessionStore(prisma, KEY_A)
      let bEnteredWhileAHeld = false
      let aHolding = false

      await Promise.all([
        store.withLock(a, async () => { aHolding = true; await sleep(250); aHolding = false }),
        sleep(60).then(() => store.withLock(b, async () => { bEnteredWhileAHeld = aHolding })),
      ])

      expect(bEnteredWhileAHeld).toBe(true)
    })
  })
})
