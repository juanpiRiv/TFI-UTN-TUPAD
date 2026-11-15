import { createHash } from 'node:crypto'
import type { ArcaWsaaSessionKey, ArcaWsaaSessionStore } from 'facturas'
import type { PrismaClient } from '../../../generated/prisma/client.js'
import { decryptSecret, encryptSecret } from '../secret-box.js'

type Credentials = Parameters<ArcaWsaaSessionStore['set']>[1]

/** Margen para no usar un ticket que está por vencer. */
const SAFETY_MARGIN_MS = 60_000
/** El pedido a ARCA corre dentro del bloqueo: la transacción tiene que durar más que el pedido más lento. */
const LOCK_TRANSACTION_TIMEOUT_MS = 60_000
/** Cuánto espera una instancia a que otra termine de pedir el ticket antes de rendirse. */
const LOCK_MAX_WAIT_MS = 30_000

/**
 * Cuántos bloqueos puede haber a la vez en este proceso. Cada uno ocupa una conexión del pool mientras dura
 * el pedido a ARCA, y ese pedido necesita otra conexión para leer y guardar el ticket: sin tope, varias
 * organizaciones renovando a la vez agotarían el pool (10 por defecto) y todo esperaría hasta vencer el tiempo.
 */
const MAX_CONCURRENT_LOCKS = 3

let activeLocks = 0
const lockWaiters: Array<() => void> = []

async function acquireLockSlot(): Promise<void> {
  if (activeLocks < MAX_CONCURRENT_LOCKS) {
    activeLocks++
    return
  }
  await new Promise<void>((resolve) => lockWaiters.push(resolve))
}

function releaseLockSlot(): void {
  const next = lockWaiters.shift()
  if (next) next() // el lugar pasa directo al siguiente
  else activeLocks--
}

/** Lo mínimo del cliente de Prisma que usa el almacén. */
export type WsaaStoreClient = Pick<PrismaClient, 'arcaWsaaTicket' | '$transaction'>

/**
 * Guarda el ticket de acceso (TA) del WSAA en PostgreSQL, cifrado, para compartirlo entre instancias.
 *
 * Por qué: ARCA responde `coe.alreadyAuthenticated` si se pide un segundo ticket mientras el primero
 * (12 horas) sigue vigente. Con más de una instancia del backend (por ejemplo en Render) o con disco
 * efímero, el archivo no alcanza: todas las instancias tienen que ver el mismo ticket y pedirlo de a una.
 *
 * Token y firma se cifran con AES-256-GCM (`secret-box`), con la huella del registro como dato asociado:
 * una fila copiada a otro id no se descifra. Un registro que no se puede descifrar (otra clave, alterado)
 * se trata como si no hubiera ticket, pero NO se borra: durante una rotación de clave o un despliegue con
 * instancias de claves distintas, borrarlo le quitaría el ticket vigente a la instancia que sí lo puede leer
 * (ARCA no entrega otro mientras el anterior vive). El próximo `set()` lo reemplaza.
 */
export class DbWsaaSessionStore implements ArcaWsaaSessionStore {
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(
    private readonly client: WsaaStoreClient,
    private readonly encryptionKey: Buffer,
  ) {}

  static idFor(key: ArcaWsaaSessionKey): string {
    return createHash('sha256').update(JSON.stringify([key.environment, key.service, key.certificateFingerprint])).digest('hex')
  }

  private aad(id: string): string {
    return `arca-wsaa:${id}`
  }

  async get(key: ArcaWsaaSessionKey): Promise<Credentials | null> {
    const id = DbWsaaSessionStore.idFor(key)
    const row = await this.client.arcaWsaaTicket.findUnique({ where: { id } })
    if (!row) return null
    if (row.expiresAt.getTime() - Date.now() <= SAFETY_MARGIN_MS) {
      // Se borra solo si sigue siendo el mismo registro vencido: otra instancia pudo haberlo renovado entre medio.
      await this.client.arcaWsaaTicket.deleteMany({ where: { id, expiresAt: row.expiresAt } })
      return null
    }
    try {
      return {
        token: decryptSecret(row.tokenEncrypted, this.encryptionKey, this.aad(id)),
        sign: decryptSecret(row.signEncrypted, this.encryptionKey, this.aad(id)),
        expiresAt: row.expiresAt.toISOString(),
      }
    } catch {
      // Sin detalle del secreto: solo se informa que el registro no sirve y se lo descarta.
      console.error('[arca] el ticket de WSAA guardado no se pudo descifrar con la clave de este servidor; se pedirá uno nuevo.')
      return null
    }
  }

  async set(key: ArcaWsaaSessionKey, credentials: Credentials): Promise<void> {
    const id = DbWsaaSessionStore.idFor(key)
    const data = {
      environment: key.environment,
      service: key.service,
      tokenEncrypted: encryptSecret(credentials.token, this.encryptionKey, this.aad(id)),
      signEncrypted: encryptSecret(credentials.sign, this.encryptionKey, this.aad(id)),
      expiresAt: new Date(credentials.expiresAt),
    }
    await this.client.arcaWsaaTicket.upsert({ where: { id }, create: { id, ...data }, update: data })
    // Limpieza oportunista de tickets de certificados que ya no se usan.
    await this.client.arcaWsaaTicket.deleteMany({ where: { expiresAt: { lt: new Date() } } })
  }

  async delete(key: ArcaWsaaSessionKey): Promise<void> {
    await this.client.arcaWsaaTicket.deleteMany({ where: { id: DbWsaaSessionStore.idFor(key) } })
  }

  /**
   * Exclusión entre instancias con un bloqueo asesor de PostgreSQL a nivel de transacción
   * (`pg_advisory_xact_lock`). Se elige el de transacción y no el de sesión porque se libera solo al
   * terminar la transacción, aunque la instancia se caiga o venza el tiempo: un bloqueo de sesión
   * depende de volver a la misma conexión del pool para liberarlo, y se pierde con un pooler externo.
   * El costo es una conexión del pool ocupada durante el pedido a ARCA. Además se serializa dentro del
   * proceso para no ocupar una conexión por cada pedido que espera.
   */
  async withLock<T>(key: ArcaWsaaSessionKey, fn: () => Promise<T>): Promise<T> {
    const id = DbWsaaSessionStore.idFor(key)
    const previous = this.locks.get(id) ?? Promise.resolve()
    const run = previous.then(
      () => this.runExclusive(id, fn),
      () => this.runExclusive(id, fn),
    )
    this.locks.set(id, run.catch(() => undefined))
    return run
  }

  private async runExclusive<T>(id: string, fn: () => Promise<T>): Promise<T> {
    await acquireLockSlot()
    try {
      return await this.client.$transaction(
        async (tx) => {
          await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`arca-wsaa:${id}`}, 0))`
          return fn()
        },
        { timeout: LOCK_TRANSACTION_TIMEOUT_MS, maxWait: LOCK_MAX_WAIT_MS },
      )
    } finally {
      releaseLockSlot()
    }
  }
}
