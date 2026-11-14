import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { decryptSecret, encryptSecret, EncryptionKeyError, parseEncryptionKey } from './secret-box.js'

const key = randomBytes(32)
const PEM = '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBgkqhkiG9w0BAQEFAASC\n-----END PRIVATE KEY-----'

describe('parseEncryptionKey', () => {
  it('acepta 64 caracteres hexadecimales', () => {
    expect(parseEncryptionKey(randomBytes(32).toString('hex'))).toHaveLength(32)
  })

  it('explica qué falta si no está definida o es inválida', () => {
    expect(() => parseEncryptionKey(undefined)).toThrow(EncryptionKeyError)
    expect(() => parseEncryptionKey('')).toThrow(/Falta ARCA_ENCRYPTION_KEY/)
    expect(() => parseEncryptionKey('corta')).toThrow(/64 caracteres hexadecimales/)
  })
})

describe('encryptSecret y decryptSecret', () => {
  it('descifra lo que cifró', () => {
    expect(decryptSecret(encryptSecret(PEM, key, 'org:1'), key, 'org:1')).toBe(PEM)
  })

  it('lo guardado no contiene el texto original', () => {
    const stored = encryptSecret(PEM, key, 'org:1')

    expect(stored.startsWith('v1.')).toBe(true)
    expect(stored).not.toContain('PRIVATE KEY')
    expect(stored).not.toContain('MIIEvQ')
  })

  it('cifrar dos veces el mismo texto da resultados distintos (IV aleatorio)', () => {
    expect(encryptSecret(PEM, key, 'org:1')).not.toBe(encryptSecret(PEM, key, 'org:1'))
  })

  it('no se descifra con otra clave, con otra organización ni si se altera el registro', () => {
    const stored = encryptSecret(PEM, key, 'org:1')
    const [version, iv, tag, encrypted] = stored.split('.')
    const altered = [version, iv, tag, Buffer.from('otro-contenido').toString('base64')].join('.')

    expect(() => decryptSecret(stored, randomBytes(32), 'org:1')).toThrow(/No se pudo descifrar/)
    expect(() => decryptSecret(stored, key, 'org:2')).toThrow(/No se pudo descifrar/)
    expect(() => decryptSecret(altered, key, 'org:1')).toThrow(/No se pudo descifrar/)
    expect(encrypted).toBeTruthy()
  })

  it('rechaza un formato desconocido', () => {
    expect(() => decryptSecret('texto-plano', key, 'org:1')).toThrow(/formato desconocido/)
  })

  it('el error de descifrado nunca incluye el secreto', () => {
    expect.assertions(1)
    try {
      decryptSecret(encryptSecret(PEM, key, 'org:1'), randomBytes(32), 'org:1')
    } catch (error) {
      expect((error as Error).message).not.toContain('PRIVATE KEY')
    }
  })
})
