import { mkdtemp, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { FileWsaaSessionStore } from './wsaa-session-store.js'

const key = { environment: 'test', service: 'wsfe', certificateFingerprint: 'abc123' } as const
const inTwelveHours = () => new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString()

describe('FileWsaaSessionStore', () => {
  let directory: string
  let store: FileWsaaSessionStore

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), 'wsaa-store-'))
    store = new FileWsaaSessionStore(join(directory, 'sessions'))
  })
  afterEach(() => rm(directory, { recursive: true, force: true }))

  it('devuelve el ticket guardado, también desde otra instancia (otro proceso)', async () => {
    const credentials = { token: 'T', sign: 'S', expiresAt: inTwelveHours() }
    await store.set(key, credentials)

    const otherProcess = new FileWsaaSessionStore(join(directory, 'sessions'))
    expect(await otherProcess.get(key)).toEqual(credentials)
  })

  it('no mezcla tickets de otro certificado o de otro ambiente', async () => {
    await store.set(key, { token: 'T', sign: 'S', expiresAt: inTwelveHours() })

    expect(await store.get({ ...key, certificateFingerprint: 'otro' })).toBeNull()
    expect(await store.get({ ...key, environment: 'production' })).toBeNull()
  })

  it('descarta un ticket vencido o por vencer y borra el archivo', async () => {
    await store.set(key, { token: 'T', sign: 'S', expiresAt: new Date(Date.now() + 30_000).toISOString() })

    expect(await store.get(key)).toBeNull()
    expect(await readdir(join(directory, 'sessions'))).toEqual([])
  })

  it('un archivo dañado o incompleto se trata como si no hubiera ticket', async () => {
    await store.set(key, { token: 'T', sign: 'S', expiresAt: inTwelveHours() })
    const [file] = await readdir(join(directory, 'sessions'))
    await writeFile(join(directory, 'sessions', file!), '{no es json')

    expect(await store.get(key)).toBeNull()
  })

  it('guarda con permisos privados: directorio 700 y archivo 600', async () => {
    await store.set(key, { token: 'T', sign: 'S', expiresAt: inTwelveHours() })
    const [file] = await readdir(join(directory, 'sessions'))

    expect((await stat(join(directory, 'sessions'))).mode & 0o777).toBe(0o700)
    expect((await stat(join(directory, 'sessions', file!))).mode & 0o777).toBe(0o600)
  })

  it('delete borra el ticket', async () => {
    await store.set(key, { token: 'T', sign: 'S', expiresAt: inTwelveHours() })
    await store.delete(key)

    expect(await store.get(key)).toBeNull()
  })

  it('withLock ejecuta de a una las operaciones sobre la misma clave', async () => {
    const order: string[] = []
    const slow = store.withLock(key, async () => {
      order.push('inicio A')
      await new Promise((resolve) => setTimeout(resolve, 20))
      order.push('fin A')
    })
    const fast = store.withLock(key, async () => {
      order.push('B')
    })
    await Promise.all([slow, fast])

    expect(order).toEqual(['inicio A', 'fin A', 'B'])
  })
})
