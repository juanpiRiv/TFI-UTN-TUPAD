import { randomBytes } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import { aadFor, csrAadFor } from './arca-credential.service.js'
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

function fakePrisma(initial: Row[], initialTickets: Ticket[] = [], afterRead?: (rows: Row[]) => Row[], initialCsr: Row[] = []) {
  let csrRows = initialCsr.map((row) => ({ ...row }))
  let rows = initial.map((row) => ({ ...row }))
  let tickets = initialTickets.map((ticket) => ({ ...ticket }))
  const client = {
    $transaction: async (fn: (tx: unknown) => Promise<unknown>) => {
      let snapshot = rows.map((row) => ({ ...row }))
      const csrSnapshot = csrRows.map((row) => ({ ...row }))
      const ticketSnapshot = tickets.map((ticket) => ({ ...ticket }))
      const tx = {
        arcaWsaaTicket: {
          findMany: async () => tickets.map((ticket) => ({ ...ticket })),
          updateMany: async ({ where, data }: { where: { id: string; tokenEncrypted: string }; data: Partial<Ticket> }) => {
            const match = tickets.find((ticket) => ticket.id === where.id && ticket.tokenEncrypted === where.tokenEncrypted)
            if (match) tickets = tickets.map((ticket) => (ticket === match ? { ...ticket, ...data } : ticket))
            return { count: match ? 1 : 0 }
          },
          deleteMany: async ({ where }: { where: { id: string } }) => {
            tickets = tickets.filter((ticket) => ticket.id !== where.id)
            return { count: 1 }
          },
        },
        arcaCsrRequest: {
          findMany: async () => csrRows.map((row) => ({ ...row })),
          updateMany: async ({ where, data }: { where: { id: number; privateKeyEncrypted: string }; data: { privateKeyEncrypted: string } }) => {
            const match = csrRows.find((row) => row.id === where.id && row.privateKeyEncrypted === where.privateKeyEncrypted)
            if (match) csrRows = csrRows.map((row) => (row === match ? { ...row, ...data } : row))
            return { count: match ? 1 : 0 }
          },
          deleteMany: async ({ where }: { where: { id: number } }) => {
            csrRows = csrRows.filter((row) => row.id !== where.id)
            return { count: 1 }
          },
        },
        arcaCredential: {
          findMany: async () => {
            const read = rows.map((row) => ({ ...row }))
            if (afterRead) {
              rows = afterRead(rows) // otro proceso escribe entre la lectura y la escritura
              snapshot = rows.map((row) => ({ ...row })) // esa escritura es de otro proceso: no la deshace el rollback de la rotación
            }
            return read
          },
          updateMany: vi.fn(async ({ where, data }: { where: { id: number; privateKeyEncrypted: string }; data: { privateKeyEncrypted: string } }) => {
            const match = rows.find((row) => row.id === where.id && row.privateKeyEncrypted === where.privateKeyEncrypted)
            if (match) rows = rows.map((row) => (row === match ? { ...row, ...data } : row))
            return { count: match ? 1 : 0 }
          }),
        },
      }
      try {
        return await fn(tx)
      } catch (error) {
        rows = snapshot
        tickets = ticketSnapshot
        csrRows = csrSnapshot
        throw error
      }
    },
  }
  return { client: client as never, rows: () => rows, tickets: () => tickets, csr: () => csrRows }
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

    expect(report).toEqual({ rotated: 2, alreadyRotated: 0, ticketsRotated: 0, ticketsDiscarded: 0, csrRotated: 0, csrAlreadyRotated: 0, csrDiscarded: 0, dryRun: false })
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

    expect(report).toEqual({ rotated: 1, alreadyRotated: 0, ticketsRotated: 0, ticketsDiscarded: 0, csrRotated: 0, csrAlreadyRotated: 0, csrDiscarded: 0, dryRun: true })
    expect(db.rows()[0]?.privateKeyEncrypted).toBe(original.privateKeyEncrypted)
  })

  it('se puede repetir: lo que ya usa la clave nueva se cuenta y no se toca', async () => {
    const [oldKey, newKey] = [hex(), hex()]
    const db = fakePrisma([rowFor(1, 10, oldKey), rowFor(2, 20, newKey)])
    const already = db.rows()[1]!.privateKeyEncrypted

    const report = await rotateEncryptionKey(db.client, { oldKeyHex: oldKey, newKeyHex: newKey, apply: true })

    expect(report).toEqual({ rotated: 1, alreadyRotated: 1, ticketsRotated: 0, ticketsDiscarded: 0, csrRotated: 0, csrAlreadyRotated: 0, csrDiscarded: 0, dryRun: false })
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

  it('si alguien guarda una credencial mientras se rota, aborta sin pisarla', async () => {
    const [oldKey, newKey] = [hex(), hex()]
    const fresh = rowFor(1, 10, oldKey).privateKeyEncrypted
    const db = fakePrisma([rowFor(1, 10, oldKey)], [], (rows) =>
      rows.map((row) => ({ ...row, privateKeyEncrypted: encryptSecret('credencial-nueva', Buffer.from(oldKey, 'hex'), aadFor(row.organizationId)) })),
    )

    await expect(rotateEncryptionKey(db.client, { oldKeyHex: oldKey, newKeyHex: newKey, apply: true })).rejects.toThrow(/cambió mientras se rotaba/)
    expect(decryptSecret(db.rows()[0]!.privateKeyEncrypted, Buffer.from(oldKey, 'hex'), aadFor(10))).toBe('credencial-nueva')
    expect(db.rows()[0]!.privateKeyEncrypted).not.toBe(fresh)
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

  describe('solicitudes de certificado pendientes', () => {
    const csrRow = (id: number, organizationId: number, keyHex: string): Row => ({
      id,
      organizationId,
      privateKeyEncrypted: encryptSecret(PEM, Buffer.from(keyHex, 'hex'), csrAadFor(organizationId)),
    })

    it('vuelve a cifrar la clave pendiente con la clave nueva', async () => {
      const [oldKey, newKey] = [hex(), hex()]
      const db = fakePrisma([], [], undefined, [csrRow(1, 10, oldKey)])

      const report = await rotateEncryptionKey(db.client, { oldKeyHex: oldKey, newKeyHex: newKey, apply: true })

      expect(report).toMatchObject({ csrRotated: 1, csrAlreadyRotated: 0, csrDiscarded: 0 })
      const [row] = db.csr()
      expect(decryptSecret(row!.privateKeyEncrypted, Buffer.from(newKey, 'hex'), csrAadFor(10))).toBe(PEM)
      expect(() => decryptSecret(row!.privateKeyEncrypted, Buffer.from(oldKey, 'hex'), csrAadFor(10))).toThrow()
    })

    it('cuenta las que ya usan la clave nueva y descarta las ilegibles', async () => {
      const [oldKey, newKey, otherKey] = [hex(), hex(), hex()]
      const db = fakePrisma([], [], undefined, [csrRow(1, 10, newKey), csrRow(2, 20, otherKey), csrRow(3, 30, oldKey)])

      const report = await rotateEncryptionKey(db.client, { oldKeyHex: oldKey, newKeyHex: newKey, apply: true })

      expect(report).toMatchObject({ csrRotated: 1, csrAlreadyRotated: 1, csrDiscarded: 1 })
      expect(db.csr().map((row) => row.id)).toEqual([1, 3])
    })

    it('en simulación no escribe ni borra', async () => {
      const [oldKey, newKey, otherKey] = [hex(), hex(), hex()]
      const original = csrRow(1, 10, oldKey)
      const db = fakePrisma([], [], undefined, [original, csrRow(2, 20, otherKey)])

      const report = await rotateEncryptionKey(db.client, { oldKeyHex: oldKey, newKeyHex: newKey })

      expect(report).toMatchObject({ csrRotated: 1, csrDiscarded: 1, dryRun: true })
      expect(db.csr()).toHaveLength(2)
      expect(db.csr()[0]?.privateKeyEncrypted).toBe(original.privateKeyEncrypted)
    })

    it('una solicitud copiada a otra organización no se rota: se descarta', async () => {
      const [oldKey, newKey] = [hex(), hex()]
      const copied = { ...csrRow(1, 10, oldKey), organizationId: 99 }
      const db = fakePrisma([], [], undefined, [copied])

      const report = await rotateEncryptionKey(db.client, { oldKeyHex: oldKey, newKeyHex: newKey, apply: true })

      expect(report).toMatchObject({ csrRotated: 0, csrDiscarded: 1 })
      expect(db.csr()).toHaveLength(0)
    })
  })
})
