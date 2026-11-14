import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

/**
 * Cifrado de secretos en la base (la clave privada de ARCA de cada organización).
 * AES-256-GCM con un IV aleatorio por registro. El texto cifrado queda atado a un dato asociado
 * (el id de la organización): un registro copiado a otra fila no se puede descifrar.
 *
 * Formato guardado: `v1.<iv>.<tag>.<cifrado>`, todo en base64.
 */
const VERSION = 'v1'
const IV_BYTES = 12
const TAG_BYTES = 16

export class EncryptionKeyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'EncryptionKeyError'
  }
}

/** Convierte ARCA_ENCRYPTION_KEY (64 caracteres hexadecimales = 32 bytes) en la clave. */
export function parseEncryptionKey(hex: string | undefined): Buffer {
  const value = hex?.trim()
  if (!value) throw new EncryptionKeyError('Falta ARCA_ENCRYPTION_KEY: no se puede guardar ni leer la clave privada de ARCA.')
  if (!/^[0-9a-fA-F]{64}$/.test(value)) {
    throw new EncryptionKeyError('ARCA_ENCRYPTION_KEY tiene que tener 64 caracteres hexadecimales (openssl rand -hex 32).')
  }
  return Buffer.from(value, 'hex')
}

export function encryptSecret(plain: string, key: Buffer, associatedData: string): string {
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: TAG_BYTES })
  cipher.setAAD(Buffer.from(associatedData, 'utf8'))
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return [VERSION, iv.toString('base64'), cipher.getAuthTag().toString('base64'), encrypted.toString('base64')].join('.')
}

export function decryptSecret(payload: string, key: Buffer, associatedData: string): string {
  const [version, iv, tag, encrypted] = payload.split('.')
  if (version !== VERSION || !iv || !tag || !encrypted) throw new Error('El secreto guardado tiene un formato desconocido.')
  try {
    const tagBytes = Buffer.from(tag, 'base64')
    if (tagBytes.length !== TAG_BYTES) throw new Error('etiqueta inválida')
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'), { authTagLength: TAG_BYTES })
    decipher.setAAD(Buffer.from(associatedData, 'utf8'))
    decipher.setAuthTag(tagBytes)
    return Buffer.concat([decipher.update(Buffer.from(encrypted, 'base64')), decipher.final()]).toString('utf8')
  } catch {
    // Sin detalle: puede ser otra clave, otra organización o un registro alterado.
    throw new Error('No se pudo descifrar el secreto guardado: la clave de cifrado o el registro no corresponden.')
  }
}
