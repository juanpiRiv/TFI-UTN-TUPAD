import { homedir } from 'node:os'
import { join } from 'node:path'
import type { ArcaWsaaSessionStore } from 'facturas'
import { DbWsaaSessionStore, type WsaaStoreClient } from './sdk/db-wsaa-session-store.js'
import { FileWsaaSessionStore } from './sdk/wsaa-session-store.js'
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
 *  - archivo en cualquier otro caso (desarrollo y scripts sin base de datos, que no pasan `client`).
 */
export function createWsaaSessionStore(env: WsaaStoreEnv, client?: WsaaStoreClient): ArcaWsaaSessionStore {
  if (client && env.ARCA_ENCRYPTION_KEY?.trim()) {
    try {
      return new DbWsaaSessionStore(client, parseEncryptionKey(env.ARCA_ENCRYPTION_KEY))
    } catch (error) {
      // Una clave mal formada se avisa y se sigue con el archivo; guardar credenciales ya la rechaza aparte.
      if (!(error instanceof EncryptionKeyError)) throw error
      console.warn(`[arca] ${error.message} El ticket de WSAA se guarda en archivo.`)
    }
  }
  return new FileWsaaSessionStore(defaultSessionDir(env))
}
