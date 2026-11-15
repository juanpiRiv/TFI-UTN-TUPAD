import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ArcaWsaaSessionStore } from 'facturas'
import { DbWsaaSessionStore, type WsaaStoreClient } from './sdk/db-wsaa-session-store.js'
import { FileWsaaSessionStore } from './sdk/wsaa-session-store.js'
import { ProviderUnavailableError } from './errors.js'
import { EncryptionKeyError, parseEncryptionKey } from './secret-box.js'

export interface WsaaStoreEnv {
  ARCA_ENCRYPTION_KEY?: string | undefined
  /** Carpeta del ticket de acceso compartido. Por defecto ~/.arca-homologacion/sessions. */
  ARCA_SESSION_DIR?: string | undefined
}

export function defaultSessionDir(env: { ARCA_SESSION_DIR?: string | undefined }): string {
  return env.ARCA_SESSION_DIR?.trim() || join(homedir(), '.arca-homologacion', 'sessions')
}

/**
 * Elige dónde se comparte el ticket de WSAA:
 *  - base de datos, cifrado, si hay un cliente de base (`client`) y una `ARCA_ENCRYPTION_KEY` válida:
 *    sirve con varias instancias del backend;
 *  - archivo si no hay cliente de base o no hay clave (desarrollo y scripts sin base de datos);
 *  - error si hay clave pero está mal formada: no se cae en silencio al archivo.
 */
export function createWsaaSessionStore(env: WsaaStoreEnv, client?: WsaaStoreClient): ArcaWsaaSessionStore {
  if (client && env.ARCA_ENCRYPTION_KEY?.trim()) {
    try {
      return new DbWsaaSessionStore(client, parseEncryptionKey(env.ARCA_ENCRYPTION_KEY))
    } catch (error) {
      // Con varias instancias, caer en silencio al archivo devolvería `coe.alreadyAuthenticated`: se corta con un motivo claro.
      if (error instanceof EncryptionKeyError) throw new ProviderUnavailableError(error.message)
      throw error
    }
  }
  return new FileWsaaSessionStore(defaultSessionDir(env))
}
