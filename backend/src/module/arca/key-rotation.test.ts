import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { aadFor } from './arca-credential.service.js'
import { rotateEncryptionKey } from './key-rotation.js'
import { decryptSecret, encryptSecret } from './secret-box.js'

const PEM = '-----BEGIN PRIVATE KEY-----\nclave-de-prueba\n-----END PRIVATE KEY-----'
const hex = () => randomBytes(32).toString('hex')

interface Row {
  id: number
  organizationId: number
  privateKeyEncrypted: string
}

/** Cliente en memoria con la misma forma que usa la rotación: la transacción es todo o nada. */
interface Ticket {
  id: string
  tokenEncrypted: string
  signEncrypted: string
  expiresAt: Date
}

function fakePrisma(initial: Row[], initialTickets: Ticket[] = []) {
  let rows = initial.map((row) => ({ ...row }))
  let tickets = initialTickets.map((ticket) => ({ ...ticket }))
  const client = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      const snapshot = rows.map((row) => ({ ...row }))
      const ticketSnapshot = tickets.map((ticket) => ({ ...ticket }))
      const tx = {
        arcaWsaaTicket: {
          findMany: async () => tickets.map((ticket) => ({ ...ticket })),
          update: async ({ where, data }: { where: { id: string }; data: Partial<Ticket> }) => {
            tickets = tickets.map((ticket) => (ticket.id === where.id ? { ...ticket, ...data } : ticket))
          },
          delete: async ({ where }: { where: { id: string } }) => {
            tickets = tickets.filter((ticket) => ticket.id !== where.id)
          },
        },
        arcaCredential: {
          findMany: async () => rows.map((row) => ({ ...row })),
          update: vi.fn(async ({ where, data }: { where: { id: number }; data: { privateKeyEncrypted: string } }) => {
            rows = rows.map((row) => (row.id === where.id ? { ...row, ...data } : row))
          }),
        },
      }
      try {
        return await fn(tx)
      } catch (error) {
        rows = snapshot
        tickets = ticketSnapshot
        throw error
      }
    },
  }
  return { client: client as never, rows: () => rows, tickets: () => tickets }
}

const rowFor = (id: number, organizationId: number, keyHex: string): Row => ({
  id,
  organizationId,
  privateKeyEncrypted: encryptSecret(PEM, Buffer.from(keyHex, 'hex'), aadFor(organizationId)),
})

describe('rotateEncryptionKey', () => {
  it('vuelve a cifrar cada credencial con la clave nueva y se descifra con ella', async () => {
    const [oldKey, newKey] = [hex(), hex()]
    const db = fakePrisma([rowFor(1, 10, oldKey), rowFor(2, 20, oldKey)])

    const report = await rotateEncryptionKey(db.client, { oldKeyHex: oldKey, newKeyHex: newKey, apply: true })

    expect(report).toEqual({ rotated: 2, alreadyRotated: 0, ticketsRotated: 0, ticketsDiscarded: 0, dryRun: false })
    for (const row of db.rows()) {
      expect(decryptSecret(row.privateKeyEncrypted, Buffer.from(newKey, 'hex'), aadFor(row.organizationId))).toBe(PEM)
      expect(() => decryptSecret(row.privateKeyEncrypted, Buffer.from(oldKey, 'hex'), aadFor(row.organizationId))).toThrow()
    }
  })

  it('por defecto simula: cuenta pero no escribe', async () => {
    const [oldKey, newKey] = [hex(), hex()]
    const original = rowFor(1, 10, oldKey)
    const db = fakePrisma([original])

    const report = await rotateEncryptionKey(db.client, { oldKeyHex: oldKey, newKeyHex: newKey })

    expect(report).toEqual({ rotated: 1, alreadyRotated: 0, ticketsRotated: 0, ticketsDiscarded: 0, dryRun: true })
    expect(db.rows()[0]?.privateKeyEncrypted).toBe(original.privateKeyEncrypted)
  })

  it('se puede repetir: lo que ya usa la clave nueva se cuenta y no se toca', async () => {
    const [oldKey, newKey] = [hex(), hex()]
    const db = fakePrisma([rowFor(1, 10, oldKey), rowFor(2, 20, newKey)])
    const already = db.rows()[1]!.privateKeyEncrypted

    const report = await rotateEncryptionKey(db.client, { oldKeyHex: oldKey, newKeyHex: newKey, apply: true })

    expect(report).toEqual({ rotated: 1, alreadyRotated: 1, ticketsRotated: 0, ticketsDiscarded: 0, dryRun: false })
    expect(db.rows()[1]?.privateKeyEncrypted).toBe(already)
  })

  it('si una credencial no se descifra con ninguna de las dos claves, no cambia nada y no nombra secretos', async () => {
    const [oldKey, newKey, otherKey] = [hex(), hex(), hex()]
    const db = fakePrisma([rowFor(1, 10, oldKey), rowFor(2, 20, otherKey)])
    const before = db.rows().map((row) => row.privateKeyEncrypted)

    const failure = rotateEncryptionKey(db.client, { oldKeyHex: oldKey, newKeyHex: newKey, apply: true })

    await expect(failure).rejects.toThrow(/organización 20.*No se cambió nada/)
    await expect(failure).rejects.not.toThrow(/PRIVATE KEY/)
    expect(db.rows().map((row) => row.privateKeyEncrypted)).toEqual(before)
  })

  it('una credencial copiada a otra organización no se rota como si fuera suya', async () => {
    const [oldKey, newKey] = [hex(), hex()]
    const copied = { ...rowFor(1, 10, oldKey), organizationId: 99 }
    const db = fakePrisma([copied])

    await expect(rotateEncryptionKey(db.client, { oldKeyHex: oldKey, newKeyHex: newKey, apply: true })).rejects.toThrow(/organización 99/)
  })

  it('rechaza claves faltantes, mal formadas o iguales', async () => {
    const db = fakePrisma([])
    const key = hex()

    await expect(rotateEncryptionKey(db.client, { oldKeyHex: undefined, newKeyHex: key })).rejects.toThrow(/Falta ARCA_ENCRYPTION_KEY/)
    await expect(rotateEncryptionKey(db.client, { oldKeyHex: key, newKeyHex: 'corta' })).rejects.toThrow(/64 caracteres/)
    await expect(rotateEncryptionKey(db.client, { oldKeyHex: key, newKeyHex: key })).rejects.toThrow(/igual a la vieja/)
  })

  describe('tickets de acceso del WSAA', () => {
    const ticketFor = (id: string, keyHex: string, expiresAt: Date): Ticket => ({
      id,
      tokenEncrypted: encryptSecret('token-de-prueba', Buffer.from(keyHex, 'hex'), `arca-wsaa:${id}`),
      signEncrypted: encryptSecret('firma-de-prueba', Buffer.from(keyHex, 'hex'), `arca-wsaa:${id}`),
      expiresAt,
    })
    const inOneHour = () => new Date(Date.now() + 3_600_000)

    it('vuelve a cifrar vigente con la clave nueva para no pedir otro ticket a ARCA', async () => {
      const [oldKey, newKey] = [hex(), hex()]
      const db = fakePrisma([], [ticketFor('a', oldKey, inOneHour())])

      const report = await rotateEncryptionKey(db.client, { oldKeyHex: oldKey, newKeyHex: newKey, apply: true })

      expect(report).toMatchObject({ ticketsRotated: 1, ticketsDiscarded: 0 })
      const [ticket] = db.tickets()
      expect(decryptSecret(ticket!.tokenEncrypted, Buffer.from(newKey, 'hex'), 'arca-wsaa:a')).toBe('token-de-prueba')
      expect(decryptSecret(ticket!.signEncrypted, Buffer.from(newKey, 'hex'), 'arca-wsaa:a')).toBe('firma-de-prueba')
    })

    it('descarta los vencidos y los que no se pueden leer, sin frenar la rotación', async () => {
      const [oldKey, newKey, otherKey] = [hex(), hex(), hex()]
      const db = fakePrisma(
        [],
        [ticketFor('vencido', oldKey, new Date(Date.now() - 1000)), ticketFor('ajeno', otherKey, inOneHour()), ticketFor('ok', oldKey, inOneHour())],
      )

      const report = await rotateEncryptionKey(db.client, { oldKeyHex: oldKey, newKeyHex: newKey, apply: true })

      expect(report).toMatchObject({ ticketsRotated: 1, ticketsDiscarded: 2 })
      expect(db.tickets().map((ticket) => ticket.id)).toEqual(['ok'])
    })

    it('en simulación no escribe ni borra tickets', async () => {
      const [oldKey, newKey] = [hex(), hex()]
      const original = ticketFor('a', oldKey, inOneHour())
      const db = fakePrisma([], [original, ticketFor('vencido', oldKey, new Date(Date.now() - 1000))])

      const report = await rotateEncryptionKey(db.client, { oldKeyHex: oldKey, newKeyHex: newKey })

      expect(report).toMatchObject({ ticketsRotated: 1, ticketsDiscarded: 1, dryRun: true })
      expect(db.tickets()).toHaveLength(2)
      expect(db.tickets()[0]?.tokenEncrypted).toBe(original.tokenEncrypted)
    })

    it('se puede repetir: un ticket que ya usa la clave nueva queda como está', async () => {
      const [oldKey, newKey] = [hex(), hex()]
      const db = fakePrisma([], [ticketFor('a', newKey, inOneHour())])
      const before = db.tickets()[0]!.tokenEncrypted

      const report = await rotateEncryptionKey(db.client, { oldKeyHex: oldKey, newKeyHex: newKey, apply: true })

      expect(report).toMatchObject({ ticketsRotated: 0, ticketsDiscarded: 0 })
      expect(db.tickets()[0]?.tokenEncrypted).toBe(before)
    })
  })
})
