import { afterEach, describe, expect, it, vi } from 'vitest'
import { createWsaaSessionStore } from './wsaa-store-factory.js'
import { DbWsaaSessionStore } from './sdk/db-wsaa-session-store.js'
import { FileWsaaSessionStore } from './sdk/wsaa-session-store.js'

const client = {} as ConstructorParameters<typeof DbWsaaSessionStore>[0]
const KEY = 'a'.repeat(64)

afterEach(() => vi.restoreAllMocks())

describe('createWsaaSessionStore', () => {
  it('usa la base de datos con cliente y clave de cifrado válida', () => {
    expect(createWsaaSessionStore({ ARCA_ENCRYPTION_KEY: KEY }, client)).toBeInstanceOf(DbWsaaSessionStore)
  })

  it('usa el archivo si no hay cliente de base (scripts de desarrollo)', () => {
    expect(createWsaaSessionStore({ ARCA_ENCRYPTION_KEY: KEY })).toBeInstanceOf(FileWsaaSessionStore)
  })

  it('usa el archivo si falta la clave de cifrado', () => {
    expect(createWsaaSessionStore({}, client)).toBeInstanceOf(FileWsaaSessionStore)
    expect(createWsaaSessionStore({ ARCA_ENCRYPTION_KEY: '  ' }, client)).toBeInstanceOf(FileWsaaSessionStore)
  })

  it('si la clave está mal formada falla con un motivo claro, sin caer al archivo ni repetir la clave', () => {
    expect(() => createWsaaSessionStore({ ARCA_ENCRYPTION_KEY: 'corta' }, client)).toThrow(/64 caracteres hexadecimales/)
    expect(() => createWsaaSessionStore({ ARCA_ENCRYPTION_KEY: 'corta' }, client)).not.toThrow(/corta.*corta/)
  })
})
