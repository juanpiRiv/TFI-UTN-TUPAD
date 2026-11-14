import { createHash } from 'node:crypto'
import { chmod, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { ArcaWsaaSessionKey, ArcaWsaaSessionStore } from 'facturas'

type Credentials = Parameters<ArcaWsaaSessionStore['set']>[1]

/** Margen para no usar un ticket que está por vencer. */
const SAFETY_MARGIN_MS = 60_000

/**
 * Guarda el ticket de acceso (TA) del WSAA en un archivo, para compartirlo entre procesos.
 *
 * Por qué hace falta: ARCA no entrega un segundo ticket mientras el primero sigue vigente (12 horas)
 * y responde `coe.alreadyAuthenticated`. Si el backend, un script de chequeo y una tarea de CI
 * piden cada uno el suyo, el segundo falla. Con un almacén compartido, todos reutilizan el mismo.
 *
 * Es el almacén para desarrollo y homologación en una sola máquina. Para varias instancias (por
 * ejemplo el despliegue en Render con más de un proceso) hace falta uno en la base de datos.
 *
 * El archivo contiene token y firma del ticket: se crea con permisos 600 en un directorio 700.
 */
export class FileWsaaSessionStore implements ArcaWsaaSessionStore {
  private readonly locks = new Map<string, Promise<unknown>>()

  constructor(private readonly directory: string) {}

  private fileFor(key: ArcaWsaaSessionKey): string {
    const id = createHash('sha256').update(JSON.stringify([key.environment, key.service, key.certificateFingerprint])).digest('hex')
    return join(this.directory, `wsaa-${id.slice(0, 32)}.json`)
  }

  async get(key: ArcaWsaaSessionKey): Promise<Credentials | null> {
    const file = this.fileFor(key)
    let parsed: unknown
    try {
      parsed = JSON.parse(await readFile(file, 'utf8'))
    } catch {
      return null
    }
    const credentials = parsed as Partial<Credentials> | null
    if (!credentials || typeof credentials.token !== 'string' || typeof credentials.sign !== 'string' || typeof credentials.expiresAt !== 'string') {
      return null
    }
    if (new Date(credentials.expiresAt).getTime() - Date.now() <= SAFETY_MARGIN_MS) {
      await this.delete(key)
      return null
    }
    return { token: credentials.token, sign: credentials.sign, expiresAt: credentials.expiresAt }
  }

  async set(key: ArcaWsaaSessionKey, credentials: Credentials): Promise<void> {
    await mkdir(this.directory, { recursive: true, mode: 0o700 })
    await chmod(this.directory, 0o700)
    const file = this.fileFor(key)
    const temporary = `${file}.${process.pid}.tmp`
    await writeFile(temporary, JSON.stringify(credentials), { mode: 0o600 })
    await rename(temporary, file)
  }

  async delete(key: ArcaWsaaSessionKey): Promise<void> {
    await rm(this.fileFor(key), { force: true })
  }

  /** Serializa los pedidos de un mismo proceso. Entre procesos no hay bloqueo: lo cubre `coe.alreadyAuthenticated` más este archivo. */
  async withLock<T>(key: ArcaWsaaSessionKey, fn: () => Promise<T>): Promise<T> {
    const id = this.fileFor(key)
    const previous = this.locks.get(id) ?? Promise.resolve()
    const run = previous.then(fn, fn)
    this.locks.set(id, run.catch(() => undefined))
    return run
  }
}
